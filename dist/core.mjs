export const ZONE = 'Asia/Jerusalem';
const rad = n => n * Math.PI / 180;
const deg = n => n * 180 / Math.PI;
const clock = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function localParts(epoch = Date.now()) {
  const p = Object.fromEntries(clock.formatToParts(new Date(epoch)).map(p => [p.type, p.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function departureEpoch(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('יש לבחור תאריך ושעת יציאה.');
  const guess = Date.parse(`${date}T${time}:00Z`);
  const matches = [];
  for (let offset = -14; offset <= 14; offset++) {
    const t = guess + offset * 3600000;
    const p = localParts(t);
    if (p.date === date && p.time === time) matches.push(t);
  }
  if (matches.length !== 1) throw new Error('השעה שנבחרה אינה חד־משמעית בגלל מעבר שעון. יש לבחור שעה אחרת.');
  return matches[0];
}
export function validateDeparture(epoch, now = Date.now()) {
  if (!Number.isFinite(epoch) || epoch < now - 60000) throw new Error('שעת היציאה כבר עברה. יש לבחור שעה עתידית.');
  if (localParts(epoch).date > addDays(localParts(now).date, 6)) throw new Error('ניתן לבדוק תחזית עד שישה ימים קדימה.');
}
export function haversine(a, b) {
  const y = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(y), Math.sqrt(Math.max(0, 1 - y)));
}
export function bearing(a, b) {
  const d = rad(b[0] - a[0]);
  return (deg(Math.atan2(Math.sin(d) * Math.cos(rad(b[1])), Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(d))) + 360) % 360;
}
export function windComponents(speed, direction, heading) {
  const angle = rad(direction - heading);
  return { cross: Math.abs(speed * Math.sin(angle)), head: speed * Math.cos(angle), signedCross: speed * Math.sin(angle) };
}
export function roadRefs(route) {
  return [...new Set(route.legs.flatMap(l => l.steps.flatMap(s => (s.ref || '').match(/\d+/g) || [])))];
}
export function parseRoads(text) {
  if (!text.trim()) return [];
  if (!/^[\d\s,;،]+$/.test(text)) throw new Error('בכבישים מועדפים יש לכתוב מספרים בלבד, למשל: 1, 38.');
  return [...new Set(text.match(/\d+/g) || [])];
}
export function chooseRoute(routes, requested) {
  if (!routes?.length) throw new Error('לא נמצא מסלול בין הנקודות. נסה נקודה קרובה יותר לכביש.');
  const matches = routes.filter(r => requested.every(n => roadRefs(r).includes(n)));
  if (matches.length) return { route: matches.sort((a, b) => a.duration - b.duration)[0], missing: [] };
  const ranked = [...routes].sort((a, b) => requested.filter(n => roadRefs(b).includes(n)).length - requested.filter(n => roadRefs(a).includes(n)).length);
  return { route: ranked[0], missing: requested.filter(n => !roadRefs(ranked[0]).includes(n)) };
}

// Step durations supply arrival estimates. Geometry distributes each step's time
// by distance; this is a planning estimate without traffic, breaks or rider speed.
export function sampleRoute(route) {
  const edges = [];
  let distance = 0, duration = 0;
  for (const leg of route.legs) for (const step of leg.steps) {
    const cs = step.geometry?.coordinates || [];
    const lengths = cs.slice(1).map((c, i) => haversine(cs[i], c));
    const length = lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] < 0.01) continue;
      const d = step.distance * lengths[i] / length;
      const t = step.duration * lengths[i] / length;
      edges.push({ a: cs[i], b: cs[i + 1], start: distance, end: distance + d, seconds: duration, time: t, heading: bearing(cs[i], cs[i + 1]), road: step.ref ? `כביש ${step.ref}` : (step.name || 'דרך מקומית') });
      distance += d; duration += t;
    }
  }
  if (!edges.length || distance < 100) throw new Error('המסלול קצר מדי לחישוב. יש לבחור נקודות שונות.');
  const count = Math.min(50, Math.max(3, Math.ceil(distance / 5000) + 1));
  const samples = [];
  let e = 0;
  for (let i = 0; i < count; i++) {
    const at = distance * i / (count - 1);
    while (e < edges.length - 1 && edges[e].end < at) e++;
    const edge = edges[e];
    const f = Math.min(1, Math.max(0, (at - edge.start) / (edge.end - edge.start)));
    samples.push({ lon: edge.a[0] + (edge.b[0] - edge.a[0]) * f, lat: edge.a[1] + (edge.b[1] - edge.a[1]) * f, distance: at, seconds: edge.seconds + edge.time * f, heading: edge.heading, road: edge.road });
  }
  return samples;
}

export function weatherAt(hourly, epoch, heading) {
  const t = epoch / 1000;
  const times = hourly?.time;
  if (!Array.isArray(times) || times.length < 2 || t < times[0] || t > times.at(-1)) throw new Error('אין תחזית לשעת ההגעה באחד המקטעים. נסה יציאה מוקדמת יותר.');
  let i = times.findIndex(n => n >= t);
  if (i === 0) i = 1;
  const j = i - 1;
  const f = (t - times[j]) / (times[i] - times[j]);
  const values = [hourly.wind_speed_10m?.[j], hourly.wind_speed_10m?.[i], hourly.wind_direction_10m?.[j], hourly.wind_direction_10m?.[i], hourly.wind_gusts_10m?.[j], hourly.wind_gusts_10m?.[i]];
  if (!values.every(n => typeof n === 'number' && Number.isFinite(n)) || values[0] < 0 || values[1] < 0 || values[4] < 0 || values[5] < 0) throw new Error('חסרים נתוני רוח בתחזית. לא ניתן להשלים חישוב אמין כרגע.');
  const [s0, s1, d0, d1, g0, g1] = values;
  const x = s0 * Math.sin(rad(d0)) * (1 - f) + s1 * Math.sin(rad(d1)) * f;
  const y = s0 * Math.cos(rad(d0)) * (1 - f) + s1 * Math.cos(rad(d1)) * f;
  const speed = Math.hypot(x, y);
  const direction = (deg(Math.atan2(x, y)) + 360) % 360;
  const components = windComponents(speed, direction, heading);
  // Gust maxima are not interpolated. Their direction is not supplied by the
  // provider; project each adjacent hourly gust using that hour's mean direction.
  const gust = Math.max(g0, g1);
  const crossGust = Math.max(windComponents(g0, d0, heading).cross, windComponents(g1, d1, heading).cross);
  return { speed, direction, gust, crossGust, ...components };
}
export const band = value => value >= 35 ? 'high' : value >= 20 ? 'mid' : 'low';
export const bandColor = value => ({ low: '#278376', mid: '#d49a28', high: '#d95c4c' })[band(value)];
export function directionName(degrees) { return ['צפון', 'צפון־מזרח', 'מזרח', 'דרום־מזרח', 'דרום', 'דרום־מערב', 'מערב', 'צפון־מערב'][Math.round(degrees / 45) % 8]; }
