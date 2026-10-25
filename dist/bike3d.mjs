// במת התלת־ממד של מסך הרכיבה: אופנוע ורוכב על כביש, עם זרמי רוח, חץ רוח, שרוול רוח ועצים שנעים ברוח.
// Three.js נטען מ־CDN רק כשנכנסים למסך הרכיבה (ראו importmap ב־index.html).
// מערכת צירים: האופנוע נוסע לכיוון ‎-z‎, ימין הרוכב הוא ‎+x‎. הכיוון היחסי של הרוח (rel) נמדד
// מ"קדימה" עם כיוון השעון, כמו ב־view.mjs: ‏0 = מלפנים, 90 = מימין.

export const BIKE_TYPES = [
  { id: 'sport', name: 'ספורט', note: 'פיירינג מלא ותנוחה רכונה' },
  { id: 'naked', name: 'נייקד', note: 'בלי כיסויים, תנוחה זקופה' },
  { id: 'adventure', name: 'אדוונצ׳ר', note: 'גבוה, מגן רוח וארגזים' },
  { id: 'cruiser', name: 'קרוזר', note: 'נמוך וארוך, רגליים קדימה' },
  { id: 'scooter', name: 'קטנוע', note: 'גלגלים קטנים ומגן קדמי' }
];
export const BIKE_COLORS = ['#d23a2f', '#f07a1f', '#f2c230', '#9ccf3c', '#2f9e5a', '#2f6fd6', '#1c1f24', '#eef0f2'];

let THREE;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const turn = (from, to) => ((to - from) % 360 + 540) % 360 - 180;

/* ---------- עזרי בנייה ---------- */
const P = (s, y, x = 0) => new THREE.Vector3(x, y, -s);
function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = false;
  return m;
}
// צורה בפרופיל צד (s קדימה, y למעלה), מוחלקת ומשוכה לרוחב
function side(pts, width, mat, bevel = .035) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  shape.splineThru(pts.slice(1).map(([s, y]) => new THREE.Vector2(s, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 24 });
  g.rotateY(Math.PI / 2); g.translate(-width / 2, 0, 0);
  g.computeVertexNormals();
  return mesh(g, mat);
}
function rod(a, b, r, mat, capsule = false) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const geo = capsule ? new THREE.CapsuleGeometry(r, Math.max(.001, len), 6, 12) : new THREE.CylinderGeometry(r, r, len, 14);
  const m = mesh(geo, mat);
  m.position.copy(a).addScaledVector(dir, .5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
function box(w, h, d, mat, at) {
  const m = mesh(new THREE.BoxGeometry(w, h, d, 2, 2, 2), mat);
  if (at) m.position.copy(at);
  return m;
}
function ball(r, mat, at, sx = 1, sy = 1, sz = 1) {
  const m = mesh(new THREE.SphereGeometry(r, 24, 16), mat);
  m.position.copy(at); m.scale.set(sx, sy, sz);
  return m;
}
function lamp(r, depth, m, at) {
  const g = new THREE.Group();
  const shell = mesh(new THREE.CylinderGeometry(r * 1.08, r * .9, depth, 24), m.chrome);
  shell.rotation.x = Math.PI / 2; g.add(shell);
  const lens = mesh(new THREE.CircleGeometry(r, 24), m.light, false);
  lens.position.z = -depth / 2 - .002; lens.rotation.y = Math.PI; g.add(lens);
  g.position.copy(at);
  return g;
}

function materials(paint) {
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paint, metalness: .3, roughness: .28, clearcoat: 1, clearcoatRoughness: .08 }),
    dark: std('#1c1f23', .25, .55),
    plastic: std('#2a2e33', .1, .7),
    rubber: std('#131416', 0, .92),
    chrome: std('#dfe3e8', 1, .16),
    metal: std('#9aa1a8', .85, .32),
    alu: std('#b9bec4', .7, .38),
    seat: std('#1a1b1d', 0, .85),
    glass: new THREE.MeshPhysicalMaterial({ color: '#bcd9e6', metalness: 0, roughness: .05, transparent: true, opacity: .38, side: THREE.DoubleSide }),
    light: std('#fffbe6', 0, .3, { emissive: '#fff3c4', emissiveIntensity: 1.4 }),
    tail: std('#ff3b30', 0, .4, { emissive: '#ff2a1f', emissiveIntensity: 1.2 }),
    suit: std('#4b5663', .05, .7),
    pants: std('#353c45', .05, .8),
    boot: std('#121315', .1, .6),
    helmet: new THREE.MeshPhysicalMaterial({ color: paint, metalness: .2, roughness: .25, clearcoat: 1, clearcoatRoughness: .05 }),
    visor: std('#0d0f12', .7, .08)
  };
}

function wheel(r, tube, m, style = 'cast') {
  const g = new THREE.Group();
  const tire = mesh(new THREE.TorusGeometry(r - tube, tube, 16, 48), m.rubber);
  tire.rotation.y = Math.PI / 2; g.add(tire);
  const rim = mesh(new THREE.TorusGeometry(r - tube * 1.9, tube * .28, 8, 48), style === 'spoke' ? m.chrome : m.dark);
  rim.rotation.y = Math.PI / 2; g.add(rim);
  const hub = mesh(new THREE.CylinderGeometry(r * .16, r * .16, tube * 2.4, 18), m.metal);
  hub.rotation.z = Math.PI / 2; g.add(hub);
  const disc = mesh(new THREE.CylinderGeometry(r * .55, r * .55, .012, 36), m.metal);
  disc.rotation.z = Math.PI / 2; disc.position.x = tube * .9; g.add(disc);
  const inner = r - tube * 1.9, n = style === 'spoke' ? 18 : 5;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, end = new THREE.Vector3(0, Math.sin(a) * inner, Math.cos(a) * inner);
    const start = new THREE.Vector3(style === 'spoke' ? (i % 2 ? .03 : -.03) : 0, 0, 0);
    g.add(rod(start, end, style === 'spoke' ? .006 : .022, style === 'spoke' ? m.chrome : m.dark));
  }
  return g;
}

/* ---------- רוכב ---------- */
function rider(sp, m) {
  const g = new THREE.Group();
  const hip = P(...sp.hip), shoulder = P(...sp.shoulder), head = P(...sp.head);
  g.add(rod(hip, shoulder, .17, m.suit, true));
  g.add(rod(shoulder, head, .06, m.suit));
  for (const k of [-1, 1]) {
    const sh = P(sp.shoulder[0], sp.shoulder[1] - .06, k * .2);
    const hand = P(sp.hand[0], sp.hand[1], k * sp.hand[2]);
    const elbow = sh.clone().lerp(hand, .5).add(new THREE.Vector3(k * .09, -.07, 0));
    g.add(rod(sh, elbow, .062, m.suit, true), rod(elbow, hand, .054, m.suit, true), ball(.058, m.boot, hand));
    const h = P(sp.hip[0], sp.hip[1], k * .12);
    const knee = P(sp.knee[0], sp.knee[1], k * sp.knee[2]), foot = P(sp.foot[0], sp.foot[1], k * sp.foot[2]);
    g.add(rod(h, knee, .088, m.pants, true), rod(knee, foot, .07, m.pants, true));
    const boot = box(.1, .1, .24, m.boot, foot.clone().add(new THREE.Vector3(0, -.02, -.05)));
    g.add(boot);
  }
  g.add(ball(.15, m.helmet, head, 1, 1.02, 1.12));
  const visor = mesh(new THREE.SphereGeometry(.153, 24, 12, Math.PI * 1.5 - .95, 1.9, 1.05, .62), m.visor);
  visor.position.copy(head); visor.scale.set(1, 1.02, 1.12);
  g.add(visor);
  return g;
}

/* ---------- דגמי האופנועים ---------- */
function frontEnd(g, m, axle, head, spread = .11, mat = m.chrome) {
  for (const k of [-1, 1]) g.add(rod(P(axle[0], axle[1], k * spread), P(head[0], head[1], k * spread * .9), .028, mat));
  g.add(box(spread * 2.4, .05, .12, m.dark, P(head[0], head[1] - .02)));
}
function bars(g, m, at, width, rise = 0) {
  const [s, y] = at;
  if (rise) for (const k of [-1, 1]) g.add(rod(P(s + .02, y - rise, k * .08), P(s, y, k * .1), .02, m.chrome));
  g.add(rod(P(s, y, -width), P(s, y, width), .02, rise ? m.chrome : m.dark));
  for (const k of [-1, 1]) g.add(rod(P(s, y, k * width), P(s, y, k * (width - .11)), .03, m.rubber));
  for (const k of [-1, 1]) g.add(box(.02, .05, .09, m.dark, P(s + .1, y + .06, k * (width - .06))));
}
function swingarm(g, m, pivot, axle) {
  for (const k of [-1, 1]) g.add(rod(P(pivot[0], pivot[1], k * .11), P(axle[0], axle[1], k * .11), .03, m.metal));
}
function exhaust(g, m, from, to, r = .055) {
  g.add(rod(P(...from), P(...to), .025, m.chrome));
  g.add(rod(P(to[0] + .05, to[1] - .01, to[2]), P(to[0] - .25, to[1] + .05, to[2]), r, m.chrome));
}

const BUILDERS = {
  sport(m) {
    const g = new THREE.Group(), r = .32;
    const front = wheel(r, .075, m), rear = wheel(r, .09, m);
    front.position.copy(P(.74, r)); rear.position.copy(P(-.72, r)); g.add(front, rear);
    frontEnd(g, m, [.74, r], [.53, .93], .11, m.metal);
    swingarm(g, m, [-.05, .45], [-.72, r]);
    g.add(box(.3, .34, .42, m.dark, P(.1, .48)));
    g.add(side([[.98, .6], [.9, .82], [.64, .97], [.4, 1.02], [.12, .99], [-.05, .9], [-.38, .92], [-.66, 1.04], [-.82, 1.01], [-.74, .88], [-.42, .72], [-.1, .52], [.32, .38], [.66, .42], [.9, .5]], .36, m.paint));
    g.add(side([[.64, .97], [.5, 1.14], [.43, 1.12], [.55, .96]], .28, m.glass, .01));
    g.add(side([[0, .93], [-.36, .95], [-.4, .9], [-.02, .89]], .27, m.seat, .02));
    for (const k of [-1, 1]) g.add(ball(.045, m.light, P(.95, .7, k * .08), 1.4, .6, .6));
    g.add(box(.12, .03, .03, m.tail, P(-.82, .99)));
    exhaust(g, m, [.05, .3, .12], [-.42, .52, .16], .06);
    bars(g, m, [.5, .92], .24);
    g.add(rider({ hip: [-.12, 1.03], shoulder: [.28, 1.33], head: [.43, 1.46], hand: [.5, .93, .24], knee: [.16, .8, .21], foot: [-.2, .52, .18] }, m));
    return { group: g, wheels: [front, rear], radii: [r, r] };
  },
  naked(m) {
    const g = new THREE.Group(), r = .32;
    const front = wheel(r, .075, m), rear = wheel(r, .09, m);
    front.position.copy(P(.72, r)); rear.position.copy(P(-.7, r)); g.add(front, rear);
    frontEnd(g, m, [.72, r], [.5, .98], .11);
    swingarm(g, m, [-.05, .46], [-.7, r]);
    for (const [a, b] of [[[.5, .98], [-.05, .5]], [[.5, .98], [-.12, .9]], [[.42, .9], [.1, .5]], [[-.12, .9], [-.05, .5]]]) for (const k of [-1, 1]) g.add(rod(P(a[0], a[1], k * .14), P(b[0], b[1], k * .14), .022, m.paint));
    g.add(box(.3, .36, .4, m.metal, P(.12, .5)));
    for (const k of [-1, 1]) g.add(rod(P(.3, .55, k * .05), P(.38, .82, k * .06), .08, m.metal));
    g.add(side([[.48, .9], [.4, 1.08], [.05, 1.1], [-.1, .98], [-.02, .86], [.38, .84]], .38, m.paint));
    g.add(side([[-.08, .95], [-.6, 1.0], [-.76, .98], [-.62, .9], [-.1, .88]], .22, m.paint, .02));
    g.add(side([[-.06, 1.0], [-.5, 1.02], [-.55, .97], [-.08, .96]], .28, m.seat, .02));
    g.add(lamp(.1, .1, m, P(.64, .98)));
    g.add(box(.1, .03, .03, m.tail, P(-.76, .97)));
    exhaust(g, m, [.1, .3, .12], [-.35, .38, .17], .05);
    bars(g, m, [.44, 1.1], .36);
    g.add(rider({ hip: [-.14, 1.06], shoulder: [.08, 1.54], head: [.13, 1.72], hand: [.44, 1.1, .32], knee: [.18, .82, .2], foot: [-.18, .5, .18] }, m));
    return { group: g, wheels: [front, rear], radii: [r, r] };
  },
  adventure(m) {
    const g = new THREE.Group(), rf = .38, rr = .34;
    const front = wheel(rf, .075, m, 'spoke'), rear = wheel(rr, .09, m, 'spoke');
    front.position.copy(P(.78, rf)); rear.position.copy(P(-.74, rr)); g.add(front, rear);
    frontEnd(g, m, [.78, rf], [.54, 1.1], .12, m.alu);
    swingarm(g, m, [-.05, .52], [-.74, rr]);
    g.add(box(.34, .34, .42, m.metal, P(.1, .56)));
    for (const k of [-1, 1]) g.add(rod(P(.14, .58, k * .17), P(.14, .6, k * .34), .075, m.alu));
    for (const k of [-1, 1]) g.add(rod(P(.42, .9, k * .2), P(.28, .52, k * .3), .018, m.dark));
    g.add(side([[.56, 1.0], [.46, 1.2], [.04, 1.2], [-.12, 1.06], [-.06, .8], [.36, .78]], .46, m.paint));
    g.add(side([[.86, .92], [.64, 1.02], [.5, .96], [.68, .88]], .16, m.paint, .015));
    g.add(side([[.62, 1.12], [.52, 1.48], [.45, 1.46], [.54, 1.1]], .34, m.glass, .01));
    g.add(side([[-.08, 1.12], [-.68, 1.12], [-.72, 1.05], [-.08, 1.04]], .32, m.seat, .02));
    g.add(box(.22, .1, .12, m.light, P(.62, 1.04)));
    for (const k of [-1, 1]) g.add(box(.18, .42, .5, m.alu, P(-.52, .82, k * .37)));
    g.add(box(.38, .3, .38, m.alu, P(-.86, 1.22)));
    g.add(box(.1, .03, .03, m.tail, P(-.78, 1.05)));
    exhaust(g, m, [.0, .36, .14], [-.38, .62, .2], .065);
    bars(g, m, [.43, 1.25], .4, .08);
    g.add(rider({ hip: [-.18, 1.2], shoulder: [.03, 1.68], head: [.07, 1.86], hand: [.43, 1.25, .36], knee: [.18, .95, .22], foot: [-.12, .58, .2] }, m));
    return { group: g, wheels: [front, rear], radii: [rf, rr] };
  },
  cruiser(m) {
    const g = new THREE.Group(), rf = .34, rr = .33;
    const front = wheel(rf, .07, m, 'spoke'), rear = wheel(rr, .115, m, 'spoke');
    front.position.copy(P(.92, rf)); rear.position.copy(P(-.8, rr)); g.add(front, rear);
    frontEnd(g, m, [.92, rf], [.56, 1.0], .13);
    swingarm(g, m, [-.1, .42], [-.8, rr]);
    for (const [a, h] of [[.08, .3], [.28, .25]]) g.add(rod(P(a + .02, .35), P(a + h, .78), .085, m.chrome));
    g.add(box(.26, .22, .36, m.metal, P(.12, .36)));
    g.add(side([[.52, .88], [.42, 1.0], [.06, 1.03], [-.1, .93], [.05, .84], [.42, .82]], .36, m.paint));
    g.add(side([[-.1, .78], [-.48, .8], [-.6, .92], [-.66, .9], [-.56, .74], [-.1, .72]], .36, m.seat, .025));
    g.add(side([[-.42, .62], [-.66, .74], [-.96, .62], [-1.08, .42], [-1.02, .4], [-.92, .56], [-.66, .66], [-.46, .58]], .3, m.paint, .02));
    g.add(side([[1.0, .5], [.92, .62], [.78, .6], [.84, .5]], .16, m.paint, .015));
    g.add(lamp(.13, .14, m, P(.66, 1.0)));
    g.add(box(.1, .03, .03, m.tail, P(-1.05, .52)));
    for (const k of [-1, 1]) g.add(rod(P(.15, .32, k * .18), P(-1.05, .4, k * .2), .045, m.chrome));
    for (const k of [-1, 1]) g.add(box(.12, .02, .22, m.chrome, P(.42, .32, k * .26)));
    bars(g, m, [.32, 1.18], .44, .14);
    g.add(rider({ hip: [-.3, .9], shoulder: [-.4, 1.38], head: [-.38, 1.57], hand: [.32, 1.18, .4], knee: [.18, .86, .24], foot: [.44, .4, .26] }, m));
    return { group: g, wheels: [front, rear], radii: [rf, rr] };
  },
  scooter(m) {
    const g = new THREE.Group(), r = .24;
    const front = wheel(r, .07, m), rear = wheel(r, .08, m);
    front.position.copy(P(.64, r)); rear.position.copy(P(-.56, r)); g.add(front, rear);
    frontEnd(g, m, [.64, r], [.56, .8], .09, m.dark);
    g.add(side([[.62, .44], [.74, .76], [.66, 1.12], [.52, 1.2], [.46, 1.04], [.48, .5]], .42, m.paint));
    g.add(box(.36, .06, .58, m.plastic, P(.08, .34)));
    g.add(side([[-.04, .38], [-.1, .78], [-.22, .87], [-.74, .87], [-.88, .72], [-.8, .44], [-.5, .3]], .4, m.paint));
    g.add(side([[-.16, .88], [-.74, .9], [-.78, .96], [-.18, .97]], .32, m.seat, .025));
    g.add(side([[.62, 1.12], [.56, 1.32], [.5, 1.3], [.54, 1.12]], .3, m.glass, .01));
    g.add(box(.5, .1, .16, m.paint, P(.5, 1.18)));
    g.add(box(.16, .06, .04, m.light, P(.6, 1.18)));
    g.add(box(.12, .03, .03, m.tail, P(-.86, .74)));
    exhaust(g, m, [-.25, .26, .15], [-.5, .3, .18], .05);
    bars(g, m, [.5, 1.2], .32);
    g.add(rider({ hip: [-.42, .98], shoulder: [-.32, 1.48], head: [-.28, 1.67], hand: [.48, 1.2, .3], knee: [.05, .82, .2], foot: [.12, .42, .17] }, m));
    return { group: g, wheels: [front, rear], radii: [r, r] };
  }
};

/* ---------- סביבה ---------- */
function skyTexture(top, bottom) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function tree(scale, dark) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(.05, .08, .6, 6), new THREE.MeshStandardMaterial({ color: '#6b5139', roughness: .9 }));
  trunk.position.y = .3; g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: dark ? '#3f7a52' : '#5f9b5a', roughness: .85, flatShading: true });
  for (const [y, r, h] of [[.8, .5, .8], [1.25, .38, .7], [1.6, .24, .55]]) { const c = mesh(new THREE.ConeGeometry(r, h, 7), leaf); c.position.y = y; g.add(c); }
  g.scale.setScalar(scale);
  return g;
}

/* ===================== חלקים משותפים: אופנוע ואפקטי רוח ===================== */
export async function loadThree() {
  THREE ??= await import('three');
  return THREE;
}
export function buildBike({ type, color }) {
  const build = (BUILDERS[type] || BUILDERS.naked)(materials(color));
  build.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return build;
}

// אפקטי הרוח סביב האופנוע, במערכת הצירים של האופנוע (קדימה = ‎-z‎).
// מקבל ערכי יעד ומחליק אליהם, כדי שמעבר בין נקודות ייראה כמו שינוי רוח אמיתי.
export class WindRig {
  constructor() {
    this.group = new THREE.Group();
    this.target = { rel: 90, speed: 0, gust: 0, signedCross: 0, color: '#2a9d7f' };
    this.now = { rel: 90, speed: 0, gust: 0, signedCross: 0 };
    this.time = 0;
    this.arrowMat = new THREE.MeshStandardMaterial({ color: '#2a9d7f', emissive: '#2a9d7f', emissiveIntensity: .6, transparent: true, opacity: 1, roughness: .4 });
    this.arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 1, 14), this.arrowMat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = .5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(.26, .5, 20), this.arrowMat);
    head.rotation.x = Math.PI / 2; head.position.z = 1.2;
    this.arrow.add(shaft, head); this.group.add(this.arrow);
    this.streakMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8, depthWrite: false });
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(.022, .022, 1), this.streakMat, 170);
    this.streaks.frustumCulled = false; this.group.add(this.streaks);
    this.particles = Array.from({ length: 170 }, () => ({ p: new THREE.Vector3(), life: 0, max: 1 }));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0); this.white = new THREE.Color('#ffffff');
  }
  set(wind) { Object.assign(this.target, wind); }
  // מחזיר את הערכים הנוכחיים (לנטיית האופנוע ולעצים)
  update(dt, motion = 1) {
    const T = this.target, N = this.now;
    this.time += dt;
    const k = 1 - Math.exp(-dt * 5);
    N.rel += turn(N.rel, T.rel) * k;
    for (const key of ['speed', 'gust', 'signedCross']) N[key] += (T[key] - N[key]) * k;
    const rel = N.rel * Math.PI / 180;
    const from = new THREE.Vector3(Math.sin(rel), 0, -Math.cos(rel)), to = from.clone().negate();
    const color = new THREE.Color(T.color), calm = N.speed < 1;
    const pulse = Math.pow(Math.max(0, Math.sin(this.time * 1.7)), 6) * clamp((N.gust - N.speed) / 25, 0, 1);

    // חץ גדול מהצד שממנו מגיעה הרוח, אל עבר הרוכב
    const len = clamp(.5 + N.speed / 22, .6, 2.2);
    this.arrow.visible = !calm;
    this.arrow.position.copy(from).multiplyScalar(1.3 + len).setY(1.0);
    this.arrow.rotation.y = Math.atan2(to.x, to.z);
    this.arrow.scale.set(1, 1, len);
    this.arrowMat.color.lerp(color, k); this.arrowMat.emissive.lerp(color, k);

    // זרמי אוויר: פסים דקים שזורמים דרך האופנוע בכיוון הרוח
    this.streakMat.color.lerp(color.clone().lerp(this.white, .35), k);
    const active = calm ? 12 : Math.min(170, 28 + Math.round(N.speed * 4));
    const vel = (.6 + N.speed * .09) * (1 + pulse * .8) * (motion || .15);
    this.q.setFromAxisAngle(this.up, Math.atan2(to.x, to.z));
    const side = new THREE.Vector3(-to.z, 0, to.x);
    const sLen = calm ? .25 : .35 + N.speed * .025;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (i >= active) { this.m4.makeScale(0, 0, 0); this.streaks.setMatrixAt(i, this.m4); continue; }
      p.life += dt;
      if (p.life >= p.max || p.p.lengthSq() > 160) {
        p.p.copy(from).multiplyScalar(rand(4, 9)).addScaledVector(side, rand(-5, 5)).setY(rand(.15, 2.6));
        p.p.z -= 1.2;
        p.life = 0; p.max = rand(2.5, 5);
      }
      p.p.addScaledVector(to, vel * dt * 3);
      const fade = Math.min(1, p.life * 2, (p.max - p.life) * 2);
      this.s.set(1, 1, sLen * Math.max(.05, fade));
      this.m4.compose(p.p, this.q, this.s);
      this.streaks.setMatrixAt(i, this.m4);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
    return { from, to, pulse, speed: N.speed, signedCross: N.signedCross };
  }
}

// נטייה קלה אל תוך רוח הצד, רעידה במשבים וסיבוב גלגלים
export function animateBike(build, holder, wind, dt, ride, time, motion = 1) {
  if (!build) return;
  build.wheels.forEach((w, i) => { w.rotation.x -= ride * dt / build.radii[i]; });
  holder.rotation.z = (-clamp(wind.signedCross / 45, -1, 1) * .16 + Math.sin(time * 9) * wind.pulse * .03) * motion;
  holder.position.y = Math.sin(time * 14) * .004 * motion;
}

/* ===================== במה עצמאית (כשאין מפה) ===================== */
export class BikeStage {
  constructor(container) {
    this.container = container;
    this.azimuth = .42; this.elevation = .44; this.riding = false; this.running = false;
    this.offset = 0; this.time = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init() {
    await loadThree();
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = dark ? .95 : 1.05;
    this.container.append(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = this.scene = new THREE.Scene();
    scene.background = skyTexture(dark ? '#0f2430' : '#8ec5e4', dark ? '#35505a' : '#eef5ee');
    scene.fog = new THREE.Fog(dark ? '#35505a' : '#e8f1ea', 18, 70);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
    this.camera = new THREE.PerspectiveCamera(38, 1, .1, 200);

    scene.add(new THREE.HemisphereLight(dark ? '#9fc3d6' : '#dff1ff', dark ? '#1d2b26' : '#6d7f5a', dark ? .7 : 1));
    const sun = new THREE.DirectionalLight('#fff4dc', dark ? 1.2 : 2.2);
    sun.position.set(-4, 7, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
    sun.shadow.bias = -.0005;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: dark ? '#22382f' : '#b9cf9e', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 160), new THREE.MeshStandardMaterial({ color: dark ? '#2b3236' : '#3b4247', roughness: .85 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, .005, -50); road.receiveShadow = true; scene.add(road);
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: .6 });
    for (const x of [-1.55, 1.55]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(.08, 160), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(x, .01, -50); scene.add(l); }
    this.dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(.1, 1.4), lineMat, 40);
    scene.add(this.dashes);
    this.trees = [];
    for (let i = 0; i < 16; i++) {
      const t = tree(rand(.8, 1.4), dark);
      t.position.set((i % 2 ? 1 : -1) * rand(3.2, 8), 0, rand(-70, 10));
      scene.add(t); this.trees.push(t);
    }

    this.rig = new WindRig(); scene.add(this.rig.group);
    this.lean = new THREE.Group(); scene.add(this.lean);
    this.m4 = new THREE.Matrix4();

    const el = renderer.domElement;
    el.style.touchAction = 'pan-y';
    let drag = null;
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, a: this.azimuth }; });
    addEventListener('pointermove', e => { if (drag) this.azimuth = drag.a - (e.clientX - drag.x) * .009; });
    addEventListener('pointerup', () => { drag = null; });
    addEventListener('pointercancel', () => { drag = null; });

    new ResizeObserver(() => this.resize()).observe(this.container);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(this.container);
    this.visible = true;
    this.resize();
    this.resume();
  }

  setBike(bike) {
    if (!this.scene) return;
    this.lean.clear();
    this.bike = buildBike(bike);
    this.lean.add(this.bike.group);
  }
  setWind(wind) { this.rig?.set(wind); }
  setRiding(on) { this.riding = on; }

  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.radius = w / h < .8 ? 9.6 : 7.2;
  }
  resume() {
    if (this.running || !this.renderer) return;
    this.running = true; this.last = performance.now();
    const loop = now => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
      if (!this.visible || document.hidden) return;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }
  pause() { this.running = false; }

  frame(dt) {
    const motion = this.reduced ? 0 : 1;
    this.time += dt;
    const wind = this.rig.update(dt, motion);
    const ride = (this.riding ? 9 : 3.2) * motion;
    this.offset = (this.offset + ride * dt) % 3;
    for (let i = 0; i < 40; i++) {
      this.m4.makeRotationX(-Math.PI / 2).setPosition(0, .012, -100 + i * 3 + this.offset);
      this.dashes.setMatrixAt(i, this.m4);
    }
    this.dashes.instanceMatrix.needsUpdate = true;
    const swayAxis = new THREE.Vector3(wind.to.z, 0, -wind.to.x).normalize();
    for (const t of this.trees) {
      t.position.z += ride * dt;
      if (t.position.z > 12) { t.position.z -= 80; t.position.x = Math.sign(t.position.x) * rand(3.2, 8); }
      const tilt = Math.min(.22, wind.speed * .006) + Math.sin(this.time * 3 + t.position.x) * .015 * (wind.speed / 20) + wind.pulse * .05;
      t.quaternion.setFromAxisAngle(swayAxis, tilt * motion);
    }
    animateBike(this.bike, this.lean, wind, dt, ride, this.time, motion);

    const r = this.radius, e = this.elevation;
    this.camera.position.set(Math.sin(this.azimuth) * Math.cos(e) * r, Math.sin(e) * r + .5, Math.cos(this.azimuth) * Math.cos(e) * r - .2);
    this.camera.lookAt(0, .55, -.6);
    const cx = this.camera.position.x, cz = this.camera.position.z + .6, len2 = cx * cx + cz * cz;
    for (const t of this.trees) {
      const tx = t.position.x, tz = t.position.z + .6, f = (tx * cx + tz * cz) / len2;
      t.visible = !(f > .05 && f < 1.1 && Math.hypot(tx - f * cx, tz - f * cz) < 1.6);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
