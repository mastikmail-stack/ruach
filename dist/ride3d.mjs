// מסך הרכיבה: מפת תלת־ממד עם תבליט שטח, זרמי רוח לאורך הדרך, ואופנוע תלת־ממד שנוסע על הכביש עצמו.
// MapLibre נטען רק כשפותחים את התצוגה; האופנוע מצויר בשכבה מותאמת (custom layer) של Three.js.
import { loadThree, buildBike, WindRig, animateBike } from './bike3d.mjs?v=17';

const VERSION = '4.7.1';
const SCRIPT = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const STYLE_SHEET = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
const RTL_PLUGIN = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const CHASE = { pitch: 55, zoom: 14.4, side: 24 };  // יותר מהדרך מסביב, והאופנוע עדיין קריא
const FLY_ZOOM = 14.1;

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

// MapLibre 4 returns an OFFSET from the current camera target, not an absolute
// altitude (the API changed in v5). The camera needs the absolute ground height;
// the custom model matrix below still needs the offset supplied by v4.
export function groundElevation(map, position) {
  const target = map.getCameraTargetElevation();
  const offset = map.queryTerrainElevation(position);
  return offset === null ? target : target + offset;
}

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

/* ---------- שכבת האופנוע: Three.js בתוך המפה ---------- */
// עם תבליט שטח, MapLibre מצייר שכבות לתוך משטח הפוך, ולכן כיוון הפאות מתהפך (רואים את פנים הצורות,
// אפור וכהה). מיקומים וכיוונים לא מושפעים — רק איזו פאה נחשבת "חיצונית". הופכים את צד החומרים.
function flipSides(T, root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m.side === T.FrontSide) m.side = T.BackSide;
  });
}

// גודל מסך קריא גם כשמוציאים זום; המצלמה עוקבת אחרי מרכז הדגם, לא נקודת המגע של הגלגל.
class BikeLayer {
  constructor(owner) {
    Object.assign(this, { id: 'bike', type: 'custom', renderingMode: '3d', owner });
    this.time = 0; this.last = performance.now();
  }
  onAdd(map, gl) {
    const T = this.T;
    this.map = map;
    this.camera = new T.Camera();
    this.scene = new T.Scene();
    this.scene.add(new T.HemisphereLight('#e8f4ff', '#6d7f5a', .45));
    const sun = new T.DirectionalLight('#fff4dc', 1.3); sun.position.set(-3, 6, 4); this.scene.add(sun);
    const fill = new T.DirectionalLight('#cfe3ff', .3); fill.position.set(4, 3, -3); this.scene.add(fill);
    this.renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    // תאורה מוחזרת, כדי שהצבע והכרום ייראו טוב על רקע המפה
    if (this.Room) { this.scene.environment = new T.PMREMGenerator(this.renderer).fromScene(new this.Room(), .04).texture; this.scene.environmentIntensity = .55; this.renderer.resetState(); }
    this.root = new T.Group();
    this.heading = new T.Group(); this.root.add(this.heading);
    const shadow = new T.Mesh(new T.CircleGeometry(1, 32), new T.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: .16, depthWrite: false, side: T.DoubleSide }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; shadow.scale.set(.55, 1.25, 1);
    this.heading.add(shadow);
    this.lean = new T.Group(); this.heading.add(this.lean);
    this.rig = new WindRig(); this.heading.add(this.rig.group);
    flipSides(T, this.rig.group);
    // החץ וזרמי האוויר נראים מעל הבניינים והשטח, אבל האופנוע עדיין מצויר מעליהם
    this.rig.group.traverse(o => { if (o.isMesh) { o.material.depthTest = false; o.material.depthWrite = false; o.renderOrder = -1; } });
    this.scene.add(this.root);
    this.place = new T.Matrix4(); this.rotX = new T.Matrix4().makeRotationAxis(new T.Vector3(1, 0, 0), Math.PI / 2);
    this.scaleV = new T.Vector3(); this.proj = new T.Matrix4();
    if (this.pendingBike) this.setBike(this.pendingBike);
  }
  setBike(bike) {
    if (!this.lean) { this.pendingBike = bike; return; }
    this.lean.clear();
    this.build = buildBike(bike);
    flipSides(this.T, this.build.group);
    this.modelCenter = new this.T.Box3().setFromObject(this.build.group).getCenter(new this.T.Vector3());
    this.lean.add(this.build.group);
    this.owner.recenter();
    this.map?.triggerRepaint();
  }
  placement(zoom = this.map.getZoom()) {
    const o = this.owner, canvas = this.map.getCanvas();
    const px = o.overview ? 58 : Math.min(180, Math.max(82, Math.min(canvas.clientWidth, canvas.clientHeight) * .28));
    const metersPerPixel = 40075016.686 * Math.cos(rad(o.pos[1])) / (512 * 2 ** zoom);
    const size = Math.max(1, metersPerPixel * px / 2.3);
    const mc = maplibregl.MercatorCoordinate.fromLngLat(o.pos, this.map.queryTerrainElevation?.(o.pos) || 0);
    return { mc, scale: mc.meterInMercatorCoordinateUnits() * size };
  }
  compose() {
    const canvas = this.map.getCanvas(), w = canvas.clientWidth, h = canvas.clientHeight;
    const px = this.owner.overview ? 58 : Math.min(180, Math.max(82, Math.min(w, h) * .28));
    const angle = rad(this.map.getBearing() - this.owner.heading), pitch = rad(this.map.getPitch());
    const c = this.modelCenter, units = px / 2.3;
    const dx = (c.x * Math.cos(angle) - c.z * Math.sin(angle)) * units;
    const dy = -(c.y * Math.cos(pitch) - (c.z * Math.cos(angle) + c.x * Math.sin(angle)) * Math.sin(pitch)) * units;
    const limit = (n, size) => Math.round(Math.min(size * .3, Math.max(0, n)));
    const padding = { left: limit(-2 * dx, w), right: limit(2 * dx, w), top: limit(-2 * dy, h), bottom: limit(2 * dy, h) };
    const current = this.map.getPadding();
    if (!this.composing && !this.map.isEasing() && Object.keys(padding).some(k => Math.abs(padding[k] - current[k]) > 1)) {
      this.composing = true;
      requestAnimationFrame(() => { this.composing = false; if (this.owner.running && !this.map.isEasing()) this.map.setPadding(padding); });
    }
  }
  render(gl, matrix) {
    const o = this.owner, map = this.map;
    if (!o.pos || !this.build) return;
    const now = performance.now(), dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    this.time += dt;
    const motion = o.reduced ? 0 : 1;
    const { mc, scale: s } = this.placement();
    this.place.makeTranslation(mc.x, mc.y, mc.z).scale(this.scaleV.set(s, -s, s)).multiply(this.rotX);
    this.camera.projectionMatrix = this.proj.fromArray(matrix).multiply(this.place);
    this.heading.rotation.y = -rad(o.heading);
    // Aim at the visual center of the upright model using screen padding. Keep
    // the camera elevation managed by the terrain engine, including after turns.
    this.compose();
    const wind = this.rig.update(dt, motion);
    animateBike(this.build, this.lean, wind, dt, o.flying ? 9 : 2.5, this.time, motion);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (o.running) map.triggerRepaint();
  }
}

export class Ride3D {
  constructor(container, { colorOf, bandOf, onSelect, onUserMove, bike }) {
    this.container = container;
    Object.assign(this, { colorOf, bandOf, onSelect, onUserMove });
    this.bike = bike;
    this.map = null; this.ready = null; this.option = null;
    this.particles = []; this.running = false; this.flying = null; this.lastFrame = 0; this.lastPush = 0;
    this.pos = null; this.heading = 0; this.overview = false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async open(option, places) {
    this.option = option; this.places = places;
    await Promise.all([loadLibrary(), loadThree()]);
    if (!this.map) this.ready = this.create();
    await this.ready;
    this.draw();
    this.resume();
  }

  create() {
    return new Promise((resolve, reject) => {
      const map = this.map = new maplibregl.Map({
        container: this.container, style: MAP_STYLE, center: [35, 31.8], zoom: 8, pitch: 55, maxPitch: 78,
        attributionControl: { compact: true }, dragRotate: true, touchPitch: true, fadeDuration: 0, antialias: true,
        // Constrain every camera update (including pinch/rotation and the tour)
        // before rendering, so the bike cannot drift away during a gesture.
        transformCameraUpdate: () => this.pos ? { center: new maplibregl.LngLat(...this.pos), elevation: groundElevation(this.map, this.pos) } : {}
      });
      // שגיאת אריח בודד לא מפילה את התצוגה; רק אם המפה לא נטענה בכלל
      const timer = setTimeout(() => { if (!this.loaded) { this.map.remove(); this.map = null; reject(new Error('תצוגת התלת־ממד לא נטענה. בדוק את החיבור לאינטרנט.')); } }, 30000);
      map.on('error', e => console.warn('3D map:', e.error?.message || e));
      map.on('load', async () => {
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
        map.setTerrain({ source: 'dem', exaggeration: 1.4 });
        try { map.setSky?.({ 'sky-color': '#9fc7dc', 'horizon-color': '#e4eef0', 'fog-color': '#e8f0ee', 'sky-horizon-blend': .6, 'horizon-fog-blend': .7, 'fog-ground-blend': .4 }); } catch {}
        map.addImage('wind-arrow', arrowImage(), { sdf: true });
        const empty = { type: 'FeatureCollection', features: [] };
        for (const id of ['alts', 'route', 'particles', 'arrows']) map.addSource(id, { type: 'geojson', data: empty });
        map.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#7d8f92', 'line-width': 4, 'line-opacity': .7, 'line-dasharray': [1, 2] } });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 14, 17, 26] } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 9, 17, 18], 'line-opacity': .85 } });
        map.addLayer({ id: 'particles', type: 'line', source: 'particles', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 14, 3.2] } });
        map.addLayer({ id: 'arrows', type: 'symbol', source: 'arrows', layout: { 'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, ['*', .35, ['get', 's']], 14, ['*', 1.1, ['get', 's']]] }, paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': 'rgba(255,255,255,.9)', 'icon-halo-width': 2, 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 13, 1, 15, .25] } });
        this.layer = new BikeLayer(this);
        this.layer.T = await loadThree();
        try { this.layer.Room = (await import('three/addons/environments/RoomEnvironment.js')).RoomEnvironment; } catch {}
        this.layer.setBike(this.bike);
        map.addLayer(this.layer);
        map.on('click', 'arrows', e => { const i = e.features?.[0]?.properties?.i; if (Number.isFinite(i)) this.onSelect(i); });
        map.on('mouseenter', 'arrows', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'arrows', () => { map.getCanvas().style.cursor = ''; });
        // המשתמש הזיז את המפה בעצמו — עוצרים את הנסיעה הווירטואלית
        for (const ev of ['dragstart', 'rotatestart', 'pitchstart']) map.on(ev, e => { if (e.originalEvent) { this.stopFly(); this.onUserMove?.(); } });
        map.dragPan.disable();
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        map.on('sourcedata', e => { if (e.sourceId === 'dem' && this.pos) this.recenter(); });
        map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        new ResizeObserver(() => { map.resize(); this.recenter(); }).observe(this.container);
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
    // נתיב לנסיעה: קואורדינטות עם מרחק מצטבר
    const path = o.route.geometry.coordinates;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
    this.path = path; this.cum = cum;
    this.particles = [];
  }

  setAlternatives(routes) { this.alternatives = routes; }
  setBike(bike) { this.bike = bike; this.layer?.setBike(bike); }
  setWind(wind) { this.layer?.rig?.set(wind); this.map?.triggerRepaint(); }
  recenter() { if (this.map && this.pos) this.map.jumpTo({ center: this.pos }); }

  // הנקודה על הדרך שמתאימה לנקודת הדגימה, וכיוון הכביש בה
  pointAt(sample) {
    const total = this.cum.at(-1), sampleTotal = this.option.samples.at(-1).distance || total;
    const d = sample.distance / sampleTotal * total;
    const pos = this.along(d), back = this.along(Math.max(0, d - 40)), ahead = this.along(Math.min(total, d + 40));
    return { pos, heading: haversine(back, ahead) > 3 ? bearing(back, ahead) : sample.heading, d };
  }

  // how: 'snap' קופץ למבט מאחורי הרוכב, 'ease' מחליק אליו, אחרת רק מזיז את האופנוע
  select(index, how) {
    const s = this.option?.samples?.[index]; if (!s || !this.map || this.flying) return;
    const { pos, heading } = this.pointAt(s);
    this.pos = pos; this.heading = heading;
    if (how && !this.overview) {
      const view = { center: pos, bearing: heading + CHASE.side, pitch: CHASE.pitch, zoom: CHASE.zoom };
      if (how === 'snap') this.map.jumpTo(view); else this.map.easeTo({ ...view, duration: 900 });
    } else this.recenter();
    this.map.triggerRepaint();
  }

  // כפתור "כל הדרך": מבט על כל המסלול, ולחיצה נוספת חוזרת לרוכב
  toggleOverview() {
    if (!this.map || !this.path) return false;
    this.stopFly();
    this.overview = !this.overview;
    if (!this.overview) { this.map.easeTo({ center: this.pos, bearing: this.heading + CHASE.side, pitch: CHASE.pitch, zoom: CHASE.zoom, duration: 1200 }); return false; }
    // Fit around the rider, including the mirrored extent, so the complete
    // route is visible while the rider stays at the screen center in this view too.
    let dx = 0, dy = 0;
    for (const p of this.path) { dx = Math.max(dx, Math.abs(p[0] - this.pos[0])); dy = Math.max(dy, Math.abs(p[1] - this.pos[1])); }
    const b = new maplibregl.LngLatBounds([this.pos[0] - dx, this.pos[1] - dy], [this.pos[0] + dx, this.pos[1] + dy]);
    const heading = bearing(this.path[0], this.path.at(-1));
    const cam = this.map.cameraForBounds(b, { bearing: heading, padding: { top: 80, bottom: 80, left: 32, right: 32 } });
    if (cam) this.map.easeTo({ center: this.pos, zoom: Math.min(13, cam.zoom - .5), bearing: heading, pitch: 32, duration: 1400 });
    return true;
  }

  along(d) {
    const { cum, path } = this;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const span = cum[hi] - cum[lo] || 1, f = Math.min(1, Math.max(0, (d - cum[lo]) / span));
    return [path[lo][0] + (path[hi][0] - path[lo][0]) * f, path[lo][1] + (path[hi][1] - path[lo][1]) * f];
  }

  // נסיעה וירטואלית: האופנוע נוסע לאורך הדרך והמצלמה עוקבת מאחוריו
  fly({ startIndex = 0, onStep, onEnd }) {
    if (!this.map || !this.path) return;
    this.stopFly(false);
    this.overview = false;
    const total = this.cum.at(-1), samples = this.option.samples;
    const sampleTotal = samples.at(-1).distance || total;
    const duration = Math.min(150, Math.max(30, total / 1000 * 1.1)) * 1000;
    const startD = samples[startIndex] ? samples[startIndex].distance / sampleTotal * total : 0;
    const t0 = performance.now() - startD / total * duration;
    let heading = bearing(this.along(startD), this.along(startD + 60)), lastIndex = -1;
    this.flying = true;
    const step = now => {
      if (!this.flying) return;
      const p = Math.min(1, (now - t0) / duration), d = p * total;
      const pos = this.along(d), ahead = this.along(Math.min(total, d + 120));
      if (haversine(pos, ahead) > 5) heading += turn(heading, bearing(pos, ahead)) * .12;
      this.pos = pos; this.heading = heading;
      this.map.jumpTo({ center: pos, bearing: heading + CHASE.side * .6, pitch: CHASE.pitch, zoom: FLY_ZOOM });
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
    if (this.flying !== true) cancelAnimationFrame(this.flying);
    this.flying = null;
    if (notify) this.onFlyEnd?.();
  }

  // זרמי רוח: חלקיקים שנעים לכיוון שאליו האוויר זורם, צבועים לפי עוצמת משב הצד
  resume() {
    if (this.running) return;
    this.running = true; this.lastFrame = performance.now();
    this.map?.triggerRepaint();
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
