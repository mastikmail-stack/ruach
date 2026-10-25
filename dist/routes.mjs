import { haversine, roadRefs } from './core.mjs?v=18';

export function routeURL(points, probe = null) {
  const stops = [...points];
  if (probe) stops.splice(probe.after + 1, 0, probe);
  const coordinates = stops.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = new URL(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordinates}`);
  url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true', alternatives: '3', ...(probe ? {
    continue_straight: 'true', radiuses: stops.map(() => '1500').join(';'),
    bearings: stops.map((_, i) => i === probe.after + 1 ? `${Math.round(probe.heading)},60` : '').join(';')
  } : {}) });
  return url.href;
}

function samples(line, count = 32) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths.at(-1) + haversine(line[i - 1], line[i]));
  const total = lengths.at(-1), result = [];
  let edge = 1;
  for (let i = 0; i < count; i++) {
    const d = total * i / (count - 1);
    while (edge < line.length - 1 && lengths[edge] < d) edge++;
    const f = (d - lengths[edge - 1]) / (lengths[edge] - lengths[edge - 1] || 1);
    result.push(line[edge - 1].map((v, j) => v + (line[edge][j] - v) * f));
  }
  return result;
}

function distanceToLine(p, line) {
  const x = 111320 * Math.cos(p[1] * Math.PI / 180), y = 111320;
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * x, ay = (line[i - 1][1] - p[1]) * y;
    const dx = (line[i][0] - line[i - 1][0]) * x, dy = (line[i][1] - line[i - 1][1]) * y;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

// Differences in geometry vertex density must not create duplicate choices.
// Compare the roads in both directions so a detour is not mistaken for its base.
export function sameRoads(a, b) {
  const ac = a.geometry.coordinates, bc = b.geometry.coordinates;
  const tolerance = Math.max(25, Math.min(100, Math.min(a.distance, b.distance) * .001));
  const coverage = (line, other) => samples(line).filter(p => distanceToLine(p, other) <= tolerance).length / 32;
  return coverage(ac, bc) >= .9 && coverage(bc, ac) >= .9;
}

const usable = r => Number.isFinite(r.duration) && r.duration > 0 && Number.isFinite(r.distance) && r.distance >= 100 && r.distance <= 1500000 && r.geometry?.coordinates?.length > 1;
const nearWaypoints = data => !data.waypoints?.some(w => w.distance > 1500);
const matches = (route, roads) => roads.every(n => roadRefs(route).includes(n));
function unique(routes) {
  const result = [];
  for (const route of [...routes].sort((a, b) => a.duration - b.duration)) if (!result.some(r => sameRoads(r, route))) result.push(route);
  return result;
}

export function corridorProbes(route) {
  const after = route.legs.reduce((best, leg, i) => (leg.distance || 0) > (route.legs[best].distance || 0) ? i : best, 0);
  const leg = route.legs[after];
  const line = leg.steps.flatMap(s => s.geometry?.coordinates || []);
  if (line.length < 2) return [];
  const points = samples(line, 21), meters = leg.distance || route.distance;
  const offset = Math.min(8000, Math.max(250, meters * .13));
  const probes = [];
  for (const index of [10, 13]) {
    const p = points[index], a = points[index - 1], b = points[index + 1];
    const cos = Math.cos(p[1] * Math.PI / 180), dx = (b[0] - a[0]) * cos, dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const heading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    for (const side of [1, -1]) {
      const lon = p[0] + side * dy / length * offset / (111320 * cos);
      const lat = p[1] - side * dx / length * offset / 111320;
      if (lat >= 29 && lat <= 34 && lon >= 34 && lon <= 36.2) probes.push({ lon, lat, heading, after });
    }
  }
  return probes;
}

// Keep public-service requests at least 1.1 seconds apart, including quick
// repeated searches. A superseded search never starts its queued request.
let nextRequest = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function requestSlot(isCurrent) {
  const at = Math.max(Date.now(), nextRequest);
  nextRequest = at + 1100;
  if (at > Date.now()) await pause(at - Date.now());
  if (!isCurrent()) throw new DOMException('Search superseded', 'AbortError');
}

export async function routeChoices(points, { request, requested = [], isCurrent = () => true, onProgress = () => {}, slot = requestSlot }) {
  await slot(isCurrent);
  const data = await request(routeURL(points), 35000);
  if (!isCurrent()) throw new DOMException('Search superseded', 'AbortError');
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('לא נמצאה דרך בין הנקודות. נסה לבחור נקודה קרובה יותר לכביש.');
  if (!nearWaypoints(data)) throw new Error('אחת הנקודות רחוקה מכביש. בחר נקודה קרובה יותר לכביש.');
  let routes = unique(data.routes.filter(usable));
  if (!routes.length) throw new Error('לא נמצאה דרך באורך שניתן לבדוק. נסה לפצל את הנסיעה.');
  if (routes.filter(r => matches(r, requested)).length >= 2) return { routes, extraSearch: 'not-needed' };

  // The public server does not support exclude=motorway. Instead, route through
  // up to four nearby corridors, on the longest leg, preserving all user stops.
  // OSRM supplies the actual drivable road geometry; no straight-line alternatives.
  onProgress('מחפש גם דרכים בכבישים סמוכים…');
  let extraSearch = 'complete';
  const base = routes[0], deadline = Date.now() + 22000;
  for (const probe of corridorProbes(base)) {
    if (routes.filter(r => matches(r, requested)).length >= 2 || Date.now() > deadline) break;
    try {
      await slot(isCurrent);
      const more = await request(routeURL(points, probe), 6000, 1);
      if (!isCurrent()) throw new DOMException('Search superseded', 'AbortError');
      if (more.code === 'Ok' && nearWaypoints(more)) {
        const waypoint = more.waypoints?.[probe.after + 1];
        const [lon, lat] = waypoint?.location || [probe.lon, probe.lat];
        const alternatives = (more.routes || []).filter(usable).filter(r => r.distance <= base.distance * 1.65 + 3000 && r.duration <= base.duration * 2 + 600)
          .filter(r => !r.legs.some(l => l.steps.some(s => s.maneuver?.modifier === 'uturn')))
          .map(r => ({ ...r, via: { lon, lat, after: probe.after, name: waypoint?.name || 'נקודת מעבר בדרך החלופית' } }));
        routes = unique([...routes, ...alternatives]);
      } else if (more.code !== 'NoRoute' && more.code !== 'NoSegment') extraSearch = 'unavailable';
    } catch (e) {
      if (!isCurrent() || e.name === 'AbortError') throw e;
      extraSearch = 'unavailable'; // Never hide the valid primary route.
      if (e.name === 'TimeoutError') break;
    }
  }
  return { routes, extraSearch };
}
