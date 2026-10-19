// תצוגת תלת־ממד: מפה עם תבליט שטח אמיתי, זרמי רוח מונפשים וטיסת מצלמה לאורך הדרך.
// MapLibre נטען רק כשפותחים את התצוגה, כדי שהאפליקציה תישאר קלה.
const VERSION = '4.7.1';
const SCRIPT = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const STYLE_SHEET = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
const RTL_PLUGIN = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

export function supports3D() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

let loading;
function loadLibrary() {
  if (window.maplibregl) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = STYLE_SHEET; document.head.append(css);
    const js = document.createElement('script');
    js.src = SCRIPT;
    js.onload = () => {
      try { if (maplibregl.getRTLTextPluginStatus?.() === 'unavailable') maplibregl.setRTLTextPlugin(RTL_PLUGIN, true).catch?.(() => {}); } catch {}
      resolve();
    };
    js.onerror = () => { loading = null; reject(new Error('לא הצלחנו לטעון את תצוגת התלת־ממד. בדוק את החיבור לאינטרנט.')); };
    document.head.append(js);
  });
  return loading;
}

function haversine(a, b) {
  const y = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(y), Math.sqrt(Math.max(0, 1 - y)));
}
function bearing(a, b) {
  const d = rad(b[0] - a[0]);
  return (deg(Math.atan2(Math.sin(d) * Math.cos(rad(b[1])), Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(d))) + 360) % 360;
}
const turn = (from, to) => ((to - from) % 360 + 540) % 360 - 180;

// חץ לבן (SDF) שאפשר לצבוע ולסובב על פני השטח
function arrowImage() {
  const size = 64, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 4); g.lineTo(54, 30); g.lineTo(40, 30); g.lineTo(40, 60); g.lineTo(24, 60); g.lineTo(24, 30); g.lineTo(10, 30);
  g.closePath(); g.fill();
  return g.getImageData(0, 0, size, size);
}

export class Ride3D {
  constructor(container, { colorOf, bandOf, onSelect }) {
    this.container = container;
    this.colorOf = colorOf; this.bandOf = bandOf; this.onSelect = onSelect;
    this.map = null; this.ready = null; this.option = null;
    this.particles = []; this.running = false; this.flying = null; this.lastFrame = 0; this.lastPush = 0;
  }

  async open(option, places) {
    this.option = option; this.places = places;
    await loadLibrary();
    if (!this.map) this.ready = this.create();
    await this.ready;
    this.draw();
    this.fit(false);
    this.resume();
  }

  create() {
    return new Promise((resolve, reject) => {
      const map = this.map = new maplibregl.Map({
        container: this.container, style: MAP_STYLE, center: [35, 31.8], zoom: 8, pitch: 55, maxPitch: 78,
        attributionControl: { compact: true }, dragRotate: true, touchPitch: true, fadeDuration: 0
      });
      // שגיאת אריח בודד לא מפילה את התצוגה; רק אם המפה לא נטענה בכלל
      const timer = setTimeout(() => { if (!this.loaded) { this.map.remove(); this.map = null; reject(new Error('תצוגת התלת־ממד לא נטענה. בדוק את החיבור לאינטרנט.')); } }, 30000);
      map.on('error', e => console.warn('3D map:', e.error?.message || e));
      map.on('load', () => {
        this.loaded = true; clearTimeout(timer);
        map.addSource('dem', { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, encoding: 'terrarium', maxzoom: 14, attribution: 'תבליט: Mapzen / AWS Terrain Tiles' });
        map.addSource('dem-shade', { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, encoding: 'terrarium', maxzoom: 14 });
        const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
        // שמות מקומות בעברית כשיש, אחרת השם המקומי
        for (const layer of map.getStyle().layers) {
          if (layer.type !== 'symbol') continue;
          const field = map.getLayoutProperty(layer.id, 'text-field');
          if (field && JSON.stringify(field).includes('name')) map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:he'], ['get', 'name']]);
        }
        map.addLayer({ id: 'shade', type: 'hillshade', source: 'dem-shade', paint: { 'hillshade-exaggeration': .45, 'hillshade-shadow-color': '#2d3f3a' } }, firstSymbol);
        map.setTerrain({ source: 'dem', exaggeration: 1.7 });
        try { map.setSky?.({ 'sky-color': '#9fc7dc', 'horizon-color': '#e4eef0', 'fog-color': '#e8f0ee', 'sky-horizon-blend': .6, 'horizon-fog-blend': .7, 'fog-ground-blend': .4 }); } catch {}
        map.addImage('wind-arrow', arrowImage(), { sdf: true });
        const empty = { type: 'FeatureCollection', features: [] };
        for (const id of ['alts', 'route', 'particles', 'arrows']) map.addSource(id, { type: 'geojson', data: empty });
        map.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#7d8f92', 'line-width': 4, 'line-opacity': .7, 'line-dasharray': [1, 2] } });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 14] } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 9] } });
        map.addLayer({ id: 'particles', type: 'line', source: 'particles', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 14, 3.2] } });
        map.addLayer({ id: 'arrows', type: 'symbol', source: 'arrows', layout: { 'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, ['*', .35, ['get', 's']], 14, ['*', 1.1, ['get', 's']]] }, paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': 'rgba(255,255,255,.9)', 'icon-halo-width': 2 } });
        map.on('click', 'arrows', e => { const i = e.features?.[0]?.properties?.i; if (Number.isFinite(i)) this.onSelect(i); });
        map.on('mouseenter', 'arrows', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'arrows', () => { map.getCanvas().style.cursor = ''; });
        map.on('dragstart', () => this.stopFly());
        const bike = document.createElement('div');
        bike.className = 'bike-3d';
        bike.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><path d="M20 8 29 28 20 23 11 28Z"/></svg>';
        this.bike = new maplibregl.Marker({ element: bike, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([35, 31.8]).addTo(map);
        new ResizeObserver(() => map.resize()).observe(this.container);
        resolve();
      });
    });
  }

  draw() {
    const map = this.map, o = this.option; if (!map || !o) return;
    const s = o.samples;
    // הדרך נצבעת לפי משב הצד בכל קטע
    const features = []; let offset = 0, si = 0;
    for (const leg of o.route.legs) for (const step of leg.steps) {
      while (si < s.length - 1 && s[si + 1].distance < offset + step.distance / 2) si++;
      if (step.geometry?.coordinates?.length > 1) features.push({ type: 'Feature', properties: { color: this.colorOf(this.bandOf(s[si].crossGust)) }, geometry: step.geometry });
      offset += step.distance;
    }
    map.getSource('route').setData({ type: 'FeatureCollection', features });
    map.getSource('alts').setData({ type: 'FeatureCollection', features: (this.alternatives || []).map(r => ({ type: 'Feature', properties: {}, geometry: r.geometry })) });
    const maxSpeed = Math.max(10, ...s.map(x => x.speed));
    map.getSource('arrows').setData({ type: 'FeatureCollection', features: s.map((x, i) => ({ type: 'Feature', properties: { i, rot: (x.direction + 180) % 360, s: .55 + .65 * x.speed / maxSpeed, color: this.colorOf(this.bandOf(x.crossGust)) }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })) });
    // נתיב לטיסה: קואורדינטות עם מרחק מצטבר
    const path = o.route.geometry.coordinates;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
    this.path = path; this.cum = cum;
    this.particles = [];
    this.bike.setLngLat(path[0]).setRotation(bearing(path[0], path[Math.min(path.length - 1, 3)]));
  }

  setAlternatives(routes) { this.alternatives = routes; }

  fit(animate = true) {
    if (!this.map || !this.path) return;
    const b = new maplibregl.LngLatBounds(this.path[0], this.path[0]);
    this.path.forEach(c => b.extend(c));
    const start = this.path[0], end = this.path.at(-1);
    // מבט מאחורי נקודת היציאה לכיוון היעד, בזווית — כך רואים את התבליט
    const heading = bearing(start, end);
    const cam = this.map.cameraForBounds(b, { padding: { top: 90, bottom: 50, left: 40, right: 40 }, bearing: heading });
    if (!cam) return;
    this.map.easeTo({ center: cam.center, zoom: Math.min(13, cam.zoom + .2), bearing: heading, pitch: 58, duration: animate ? 1400 : 0 });
  }

  select(index, pan) {
    const s = this.option?.samples?.[index]; if (!s || !this.map || !this.bike) return;
    if (!this.flying) {
      this.bike.setLngLat([s.lon, s.lat]).setRotation(s.heading);
      if (pan) this.map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(this.map.getZoom(), 11.5), duration: 700 });
    }
  }

  along(d) {
    const { cum, path } = this;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const span = cum[hi] - cum[lo] || 1, f = Math.min(1, Math.max(0, (d - cum[lo]) / span));
    return [path[lo][0] + (path[hi][0] - path[lo][0]) * f, path[lo][1] + (path[hi][1] - path[lo][1]) * f];
  }

  // טיסת מצלמה לאורך הדרך, כמו נסיעה במבט מעל הכתף
  fly({ startIndex = 0, onStep, onEnd }) {
    if (!this.map || !this.path) return;
    this.stopFly(false);
    const total = this.cum.at(-1), samples = this.option.samples;
    const sampleTotal = samples.at(-1).distance || total;
    const duration = Math.min(80, Math.max(22, total / 1000 * .45)) * 1000;
    const startD = samples[startIndex] ? samples[startIndex].distance / sampleTotal * total : 0;
    const t0 = performance.now() - startD / total * duration;
    let heading = bearing(this.along(startD), this.along(startD + 400)), lastIndex = -1;
    const step = now => {
      if (!this.flying) return;
      const p = Math.min(1, (now - t0) / duration), d = p * total;
      const pos = this.along(d), ahead = this.along(Math.min(total, d + 600));
      if (haversine(pos, ahead) > 5) heading += turn(heading, bearing(pos, ahead)) * .06;
      this.map.jumpTo({ center: pos, bearing: heading, pitch: 64, zoom: 13.4 });
      this.bike.setLngLat(pos).setRotation(heading);
      const target = d / total * sampleTotal;
      let i = 0; while (i < samples.length - 1 && samples[i + 1].distance <= target + (samples[1]?.distance || 0) / 2) i++;
      if (i !== lastIndex) { lastIndex = i; onStep?.(i); }
      if (p >= 1) { this.stopFly(); onEnd?.(); return; }
      this.flying = requestAnimationFrame(step);
    };
    this.onFlyEnd = onEnd;
    this.flying = requestAnimationFrame(step);
  }
  stopFly(notify = true) {
    if (!this.flying) return;
    cancelAnimationFrame(this.flying); this.flying = null;
    if (notify) this.onFlyEnd?.();
  }

  // זרמי רוח: חלקיקים שנעים לכיוון שאליו האוויר זורם, צבועים לפי עוצמת משב הצד
  resume() {
    if (this.running) return;
    this.running = true; this.lastFrame = performance.now();
    const frame = now => {
      if (!this.running) return;
      const dt = Math.min(.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
      this.animate(dt);
      if (now - this.lastPush > 33) { this.lastPush = now; this.push(); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  pause() { this.running = false; this.stopFly(false); }

  animate(dt) {
    const samples = this.option?.samples; if (!samples || !this.map) return;
    const zoom = this.map.getZoom();
    const spread = .9 * 2 ** (11 - zoom) * .06;              // מעלות סביב נקודת הדגימה
    const kmPerSec = 2 ** (12 - zoom) * 1.1;                  // קנה מידה חזותי של התנועה
    const bounds = this.map.getBounds();
    const visible = samples.filter(s => bounds.contains([s.lon, s.lat]));
    const pool = visible.length ? visible : samples;
    const target = Math.min(320, 90 + pool.length * 18);
    while (this.particles.length < target) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      if (s.speed < 1) { this.particles.push({ dead: true }); continue; }
      const lon = s.lon + (Math.random() - .5) * 2 * spread / Math.cos(rad(s.lat)), lat = s.lat + (Math.random() - .5) * 2 * spread;
      this.particles.push({ s, trail: [[lon, lat]], age: 0, life: 1.6 + Math.random() * 1.8 });
    }
    for (const p of this.particles) {
      if (p.dead) continue;
      p.age += dt;
      if (p.age > p.life) { p.dead = true; continue; }
      const to = rad(p.s.direction + 180), km = p.s.speed / 25 * kmPerSec * dt;
      const [lon, lat] = p.trail.at(-1);
      p.trail.push([lon + Math.sin(to) * km / (111.32 * Math.cos(rad(lat))), lat + Math.cos(to) * km / 111.32]);
      if (p.trail.length > 9) p.trail.shift();
    }
    this.particles = this.particles.filter(p => !p.dead);
  }
  push() {
    const src = this.map?.getSource('particles'); if (!src) return;
    src.setData({ type: 'FeatureCollection', features: this.particles.filter(p => p.trail.length > 1).map(p => ({
      type: 'Feature',
      properties: { color: this.colorOf(this.bandOf(p.s.crossGust)), a: Math.min(1, p.age * 3, (p.life - p.age) * 2) * .85 },
      geometry: { type: 'LineString', coordinates: p.trail }
    })) });
  }
}
