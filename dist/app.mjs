import { ZONE, localParts, addDays, departureEpoch, validateDeparture, parseRoads, chooseRoute, sampleRoute, roadRefs, weatherAt, band, directionName } from './core.mjs';
import { windRelation } from './view.mjs';
import { navigationLinks, forecastPlan } from './navigation.mjs';

/* ---------- עזרים ---------- */
const $ = q => document.querySelector(q);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const round = n => Math.round(n);
const km = m => (m / 1000).toLocaleString('he-IL', { maximumFractionDigits: 1 });
const timeLabel = epoch => new Intl.DateTimeFormat('he-IL', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epoch));
const weekday = date => new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${date}T12:00:00Z`));
const shortDate = date => new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', day: 'numeric', month: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const BAND_WORD = { low: 'חלשה', mid: 'מורגשת', high: 'חזקה' };
const STALE_MS = 30 * 60000;

const CITIES = [
  ['תל אביב', 32.0853, 34.7818], ['ירושלים', 31.7683, 35.2137], ['חיפה', 32.7940, 34.9896], ['באר שבע', 31.2520, 34.7915], ['אילת', 29.5577, 34.9519], ['נתניה', 32.3215, 34.8532], ['אשדוד', 31.8044, 34.6553], ['אשקלון', 31.6688, 34.5743], ['טבריה', 32.7940, 35.5310], ['צפת', 32.9646, 35.4960], ['נהריה', 33.0059, 35.0941], ['עכו', 32.9281, 35.0820], ['מצפה רמון', 30.6102, 34.8019], ['ערד', 31.2588, 35.2120], ['בית שמש', 31.7470, 34.9880], ['בית שאן', 32.4971, 35.4961], ['ראש פינה', 32.9689, 35.5426], ['זכרון יעקב', 32.5707, 34.9535], ['חדרה', 32.4340, 34.9197], ['עפולה', 32.6091, 35.2892], ['כרמיאל', 32.9147, 35.2924], ['קריית שמונה', 33.2073, 35.5721], ['רחובות', 31.8948, 34.8113], ['ראשון לציון', 31.9730, 34.7925], ['פתח תקווה', 32.0840, 34.8878], ['הרצליה', 32.1663, 34.8433], ['רעננה', 32.1848, 34.8713], ['מודיעין', 31.8969, 35.0104], ['לטרון', 31.8377, 34.9788], ['נס הרים', 31.7456, 35.0586], ['בר גיורא', 31.7292, 35.0715], ['בית גוברין', 31.6133, 34.8940], ['עין גדי', 31.4530, 35.3837], ['קצרין', 32.9909, 35.6886], ['דימונה', 31.0680, 35.0331], ['נצרת', 32.6996, 35.3035], ['מטולה', 33.2775, 35.5797], ['ים המלח', 31.1990, 35.3620], ['קיסריה', 32.5190, 34.9045], ['כפר סבא', 32.1782, 34.9076]
].map(([name, lat, lon]) => ({ name, lat, lon }));
const POPULAR = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'טבריה', 'מצפה רמון', 'ראש פינה', 'אילת'];

const store = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
};
const validPoint = p => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/* ---------- מצב ---------- */
let seq = 0;
const makePlace = (id, point = null) => ({ id, point });
let places = [makePlace('start'), makePlace('end')];
let editing = null;          // מזהה השדה שנערך כרגע
let query = '';
let remote = { q: '', list: null, loading: false, extended: false, error: false };
let searchTimer, searchToken = 0;
let departure = { mode: 'now' };
let roadsText = '';
let options = [];            // חלופות דרך: {route, samples, ready}
let active = 0;
let fetchedAt = 0;
let job = 0, busy = false;
let knownRoads = [];
let rideMap, rideLayers, pickMap, selected = 0, tourTimer, compassAngle = 0, installPrompt;

/* ---------- הודעות ---------- */
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function setStatus(html, type = '') {
  const el = $('#status');
  el.className = `status ${type}`;
  el.innerHTML = html; el.hidden = !html;
}

async function fetchJSON(url, timeout = 30000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 429 ? 'השירות עמוס כרגע. נסה שוב בעוד דקה.' : 'שירות הנתונים לא זמין כרגע. נסה שוב בעוד מעט.');
  return response.json();
}

/* ===================== מסך תכנון ===================== */
const placeholder = p => p.id === 'start' ? 'מאיפה יוצאים?' : p.id === 'end' ? 'לאן נוסעים?' : 'דרך איפה עוברים?';
const rowKind = p => p.id === 'start' ? 'start' : p.id === 'end' ? 'end' : 'stop';
const ready = () => places.every(p => p.point);

function renderTrip() {
  const start = places[0], end = places.at(-1);
  const visible = places.filter(p => p.id !== 'end' || start.point || end.point || editing === 'end');
  $('#trip-rows').innerHTML = visible.map(p => `
    <div class="trip-row ${rowKind(p)} ${p.point ? 'filled' : ''} ${editing === p.id ? 'editing' : ''}" data-id="${p.id}">
      <span class="trip-dot" aria-hidden="true"><i></i></span>
      <input class="trip-input" id="in-${p.id}" value="${esc(p.point?.name || '')}" placeholder="${placeholder(p)}" aria-label="${placeholder(p)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      ${rowKind(p) === 'stop' ? `<button type="button" class="row-action" data-remove aria-label="הסרת נקודת המעבר">${icon('close')}</button>` : ''}
    </div>`).join('');
  $('#trip-rows').querySelectorAll('.trip-row').forEach(row => {
    const place = places.find(p => p.id === row.dataset.id), input = row.querySelector('input');
    input.addEventListener('focus', () => startEditing(place.id));
    input.addEventListener('input', () => { query = input.value.trim(); searchSoon(); renderPanel(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (query.length >= 2) runSearch(true); }
      if (e.key === 'Escape') stopEditing();
    });
    row.querySelector('[data-remove]')?.addEventListener('click', () => {
      places = places.filter(p => p !== place);
      if (editing === place.id) editing = null;
      renderTrip(); renderPanel(); afterTripChange();
    });
  });
  $('#trip-tools').hidden = !(start.point && end.point);
  $('#add-stop').disabled = places.length >= 7;
  $('#home-extras').hidden = !!(start.point && end.point);
  $('#trip-options').hidden = !(start.point && end.point);
}

function startEditing(id) {
  if (editing === id) return;
  editing = id; query = ''; remote = { q: '', list: null, loading: false, extended: false, error: false };
  document.querySelectorAll('.trip-row').forEach(r => r.classList.toggle('editing', r.dataset.id === id));
  const input = $(`#in-${id}`);
  if (input) { query = ''; input.select(); }
  renderPanel();
}
function stopEditing() {
  if (!editing) return;
  editing = null; clearTimeout(searchTimer); searchToken++;
  renderTrip(); renderPanel();
  document.activeElement?.blur?.();
}

function localMatches(q) {
  return CITIES.filter(c => c.name.includes(q)).sort((a, b) => a.name.indexOf(q) - b.name.indexOf(q)).slice(0, 5);
}
function resultButton(point, kind = 'city') {
  const i = icon(kind === 'recent' ? 'history' : kind === 'pin' ? 'pin' : 'city');
  return `<button type="button" class="result" data-point='${esc(JSON.stringify({ name: point.name, lat: point.lat, lon: point.lon }))}'><span class="r-icon">${i}</span><span><b>${esc(point.name)}</b>${point.detail ? `<small>${esc(point.detail)}</small>` : ''}</span></button>`;
}

function renderPanel() {
  const panel = $('#search-panel');
  if (!editing) { panel.hidden = true; panel.innerHTML = ''; return; }
  const place = places.find(p => p.id === editing);
  if (!place) { panel.hidden = true; return; }
  let html = '';
  if (!query) {
    if (place.id === 'start') html += `<button type="button" class="result locate" data-action="locate"><span class="r-icon">${icon('locate')}</span><span><b>המיקום הנוכחי שלי</b><small>לפי ה־GPS של הטלפון</small></span></button>`;
    html += `<button type="button" class="result" data-action="map"><span class="r-icon">${icon('map')}</span><span><b>בחירה על המפה</b><small>צומת, קטע כביש או כל נקודה</small></span></button>`;
    const recent = store.get('ruach-recent-places', []).filter(validPoint).slice(0, 4);
    if (recent.length) html += `<div class="panel-label">חיפושים אחרונים</div>` + recent.map(p => resultButton(p, 'recent')).join('');
    html += `<div class="panel-label">יעדים פופולריים</div><div class="panel-chips">${POPULAR.map(n => `<button type="button" class="chip" data-city="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  } else {
    const local = localMatches(query);
    const seen = new Set(local.map(p => p.name));
    const extra = (remote.q === query && remote.list ? remote.list : []).filter(p => !seen.has(p.name) && seen.add(p.name));
    html += local.map(p => resultButton(p)).join('') + extra.map(p => resultButton(p, p.kind || 'pin')).join('');
    if (remote.q === query && remote.loading) html += `<div class="panel-note"><span class="spinner"></span>מחפש…</div>`;
    else if (remote.q === query && remote.error) html += `<div class="panel-note">החיפוש לא זמין כרגע. אפשר לבחור על המפה.</div>`;
    else if (!local.length && !extra.length && remote.q === query && remote.list && remote.extended) html += `<div class="panel-note">לא נמצא "${esc(query)}". נסה שם אחר או בחר על המפה.</div>`;
    if (!remote.extended || remote.q !== query) html += `<button type="button" class="result" data-action="extended"><span class="r-icon">${icon('search')}</span><span><b>חיפוש מורחב</b><small>כתובות, צמתים ומקומות — "${esc(query)}"</small></span></button>`;
    html += `<button type="button" class="result" data-action="map"><span class="r-icon">${icon('map')}</span><span><b>בחירה על המפה</b></span></button>`;
  }
  panel.innerHTML = html; panel.hidden = false;
  panel.querySelectorAll('[data-point]').forEach(b => b.onclick = () => choose(place.id, JSON.parse(b.dataset.point)));
  panel.querySelectorAll('[data-city]').forEach(b => b.onclick = () => choose(place.id, CITIES.find(c => c.name === b.dataset.city)));
  panel.querySelector('[data-action="locate"]')?.addEventListener('click', () => locate(place.id));
  panel.querySelectorAll('[data-action="map"]').forEach(b => b.onclick = () => openPicker(place.id));
  panel.querySelector('[data-action="extended"]')?.addEventListener('click', () => runSearch(true));
}

function searchSoon() {
  clearTimeout(searchTimer);
  if (query.length < 2) return;
  searchTimer = setTimeout(() => runSearch(false), 380);
}
async function runSearch(extended) {
  clearTimeout(searchTimer);
  const q = query, token = ++searchToken;
  if (q.length < 2) return;
  remote = { q, list: remote.q === q ? remote.list : null, loading: true, extended, error: false };
  renderPanel();
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: q, count: '8', language: 'he', countryCode: 'IL' });
    const tasks = [fetchJSON(url, 12000).then(d => (d.results || []).map(r => ({ name: r.name, lat: r.latitude, lon: r.longitude, detail: r.admin2 || r.admin1 || '', kind: 'city' })))];
    // Nominatim משמש רק לחיפוש יזום (לא תוך כדי הקלדה) לפי מדיניות השימוש שלו.
    if (extended) {
      const n = new URL('https://nominatim.openstreetmap.org/search');
      n.search = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'il,ps', 'accept-language': 'he', limit: '8' });
      tasks.push(fetchJSON(n, 15000).then(d => d.map(r => {
        const parts = String(r.display_name || '').split(',').map(s => s.trim());
        return { name: r.name || parts[0], lat: +r.lat, lon: +r.lon, detail: parts.slice(1, 3).join(', '), kind: 'pin' };
      })));
    }
    const settled = await Promise.allSettled(tasks);
    if (token !== searchToken) return;
    const list = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []).filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    remote = { q, list, loading: false, extended, error: settled.every(s => s.status === 'rejected') };
  } catch {
    if (token !== searchToken) return;
    remote = { q, list: [], loading: false, extended, error: true };
  }
  renderPanel();
}

function locate(id) {
  if (!navigator.geolocation) { toast('הדפדפן לא תומך במיקום. אפשר לבחור על המפה.'); return; }
  toast('מאתר את המיקום שלך…');
  navigator.geolocation.getCurrentPosition(
    pos => { $('#toast').hidden = true; choose(id, { name: 'המיקום שלי', lat: pos.coords.latitude, lon: pos.coords.longitude }, false); },
    () => toast('לא התקבל מיקום. צריך לאשר גישה למיקום, או לבחור על המפה.'),
    { timeout: 15000, maximumAge: 60000, enableHighAccuracy: true }
  );
}

function choose(id, point, remember = true) {
  const place = places.find(p => p.id === id);
  if (!place || !validPoint(point)) return;
  place.point = { name: point.name, lat: point.lat, lon: point.lon };
  if (remember) {
    const recent = store.get('ruach-recent-places', []).filter(validPoint).filter(p => p.name !== point.name);
    store.set('ruach-recent-places', [place.point, ...recent].slice(0, 6));
  }
  editing = null; searchToken++;
  document.activeElement?.blur?.();
  renderTrip(); renderPanel();
  const next = places.find(p => !p.point);
  if (next) { requestAnimationFrame(() => $(`#in-${next.id}`)?.focus()); return; }
  calculate();
}

function afterTripChange() {
  invalidate();
  if (ready()) calculate();
}
function invalidate() {
  job++; busy = false; options = []; fetchedAt = 0; stopTour();
  $('#routes').hidden = true; setStatus('');
}

/* ---------- שעת יציאה ---------- */
const roundUp = (ms, step) => Math.ceil(ms / step) * step;
function departureEpochNow() {
  if (departure.mode === 'now') return roundUp(Date.now(), 60000);
  return departureEpoch(departure.date, departure.time);
}
function dayWord(date) {
  const today = localParts().date;
  if (date === today) return 'היום';
  if (date === addDays(today, 1)) return 'מחר';
  return `${weekday(date)} ${shortDate(date)}`;
}
function departureLabel() {
  if (departure.mode === 'now') return 'עכשיו';
  return `${dayWord(departure.date)} ${departure.time}`;
}
function quickDepartures() {
  const today = localParts().date, tomorrow = addDays(today, 1);
  const inHour = localParts(roundUp(Date.now() + 60 * 60000, 15 * 60000));
  const inThree = localParts(roundUp(Date.now() + 3 * 60 * 60000, 15 * 60000));
  return [
    { label: 'עכשיו', sub: 'יוצאים מיד', value: { mode: 'now' } },
    { label: 'בעוד שעה', sub: `${dayWord(inHour.date)} ${inHour.time}`, value: { mode: 'at', ...inHour } },
    { label: 'בעוד 3 שעות', sub: `${dayWord(inThree.date)} ${inThree.time}`, value: { mode: 'at', ...inThree } },
    { label: 'מחר בבוקר', sub: 'מחר 07:00', value: { mode: 'at', date: tomorrow, time: '07:00' } },
    { label: 'מחר בצהריים', sub: 'מחר 12:00', value: { mode: 'at', date: tomorrow, time: '12:00' } },
    { label: 'מחר אחה״צ', sub: 'מחר 16:00', value: { mode: 'at', date: tomorrow, time: '16:00' } }
  ];
}
function openDeparture() {
  const quick = quickDepartures();
  $('#departure-quick').innerHTML = quick.map((q, i) => {
    const on = departure.mode === q.value.mode && (q.value.mode === 'now' || (departure.date === q.value.date && departure.time === q.value.time));
    return `<button type="button" data-quick="${i}" class="${on ? 'active' : ''}">${q.label}<small>${q.sub}</small></button>`;
  }).join('');
  $('#departure-quick').querySelectorAll('[data-quick]').forEach(b => b.onclick = () => applyDeparture(quick[+b.dataset.quick].value));
  const today = localParts().date;
  $('#dep-day').innerHTML = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map(d => `<option value="${d}">${dayWord(d)}${d > addDays(today, 1) ? '' : ` ${shortDate(d)}`}</option>`).join('');
  const current = departure.mode === 'now' ? localParts(roundUp(Date.now(), 15 * 60000)) : departure;
  $('#dep-day').value = current.date; $('#dep-time').value = current.time;
  $('#dep-error').textContent = '';
  $('#departure-dialog').showModal();
}
function applyDeparture(value) {
  try {
    if (value.mode === 'at') validateDeparture(departureEpoch(value.date, value.time));
  } catch (e) { $('#dep-error').textContent = e.message; return; }
  departure = value;
  $('#departure-label').textContent = departureLabel();
  $('#departure-dialog').close();
  if (ready()) { invalidate(); calculate(); }
}

/* ---------- כבישים ---------- */
function roadsLabel() {
  try { const r = parseRoads(roadsText); return r.length ? `דרך ${r.join(', ')}` : 'כל הכבישים'; } catch { return 'כל הכבישים'; }
}
function openRoads() {
  $('#roads-input').value = roadsText; $('#roads-error').textContent = '';
  renderRoadSuggest();
  $('#roads-dialog').showModal();
}
function renderRoadSuggest() {
  const known = [...knownRoads].sort((a, b) => a - b).slice(0, 16);
  let chosen = []; try { chosen = parseRoads($('#roads-input').value); } catch {}
  $('#road-suggest').innerHTML = known.length ? known.map(n => `<button type="button" data-road="${n}" class="${chosen.includes(n) ? 'on' : ''}" aria-pressed="${chosen.includes(n)}">${n}</button>`).join('') : '';
  $('#road-suggest').querySelectorAll('[data-road]').forEach(b => b.onclick = () => {
    let list = []; try { list = parseRoads($('#roads-input').value); } catch {}
    list = list.includes(b.dataset.road) ? list.filter(n => n !== b.dataset.road) : [...list, b.dataset.road];
    $('#roads-input').value = list.join(', '); renderRoadSuggest();
  });
}
function applyRoads(text) {
  try { parseRoads(text); } catch (e) { $('#roads-error').textContent = e.message; return; }
  roadsText = text.trim();
  $('#roads-label').textContent = roadsLabel();
  $('#open-roads').classList.toggle('active', !!roadsText);
  if ($('#roads-dialog').open) $('#roads-dialog').close();
  if (ready()) { invalidate(); calculate(); }
}

/* ---------- חישוב דרכים ותחזית ---------- */
function routeName(route) {
  const byRef = new Map();
  for (const leg of route.legs) for (const step of leg.steps) for (const ref of (step.ref || '').match(/\d+/g) || []) {
    byRef.set(ref, (byRef.get(ref) || 0) + step.distance);
  }
  const top = [...byRef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r);
  if (top.length === 2) return `דרך כבישים ${top[0]} ו־${top[1]}`;
  if (top.length === 1) return `דרך כביש ${top[0]}`;
  const names = route.legs.flatMap(l => l.steps).filter(s => s.name).sort((a, b) => b.distance - a.distance);
  return names[0] ? `דרך ${names[0].name}` : 'דרכים מקומיות';
}

async function calculate() {
  if (!ready()) return;
  const myJob = ++job; busy = true; stopTour();
  options = []; fetchedAt = 0;
  setStatus('');
  $('#routes').hidden = false;
  $('#routes-meta').textContent = 'מחפש דרכים…';
  $('#route-cards').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    if (!navigator.onLine) throw new Error('אין חיבור לאינטרנט. התחבר ונסה שוב.');
    for (const p of places) if (p.point.lat < 29 || p.point.lat > 34 || p.point.lon < 34 || p.point.lon > 36.2) throw new Error(`"${p.point.name}" מחוץ לאזור ישראל. האפליקציה בודקת דרכים בארץ בלבד.`);
    const requested = parseRoads(roadsText);
    const dep = departureEpochNow();
    validateDeparture(dep);

    const coords = places.map(p => `${p.point.lon.toFixed(6)},${p.point.lat.toFixed(6)}`).join(';');
    let data;
    try { data = await fetchJSON(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=3`, 35000); }
    catch (e) { throw new Error(e.name === 'TimeoutError' ? 'שירות המסלולים לא ענה בזמן. נסה שוב.' : e.message); }
    if (myJob !== job) return;
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('לא נמצאה דרך בין הנקודות. נסה לבחור נקודה קרובה יותר לכביש.');
    if (data.waypoints?.some(w => w.distance > 1500)) throw new Error('אחת הנקודות רחוקה מכביש. בחר נקודה קרובה יותר לכביש.');

    const usable = data.routes.filter(r => r.distance <= 1500000);
    if (!usable.length) throw new Error('הדרך ארוכה מדי. נסה לפצל אותה לכמה רכיבות.');
    knownRoads = [...new Set(usable.flatMap(r => roadRefs(r)))];
    const matching = usable.filter(r => requested.every(n => roadRefs(r).includes(n)));
    if (!matching.length) {
      const { missing } = chooseRoute(usable, requested);
      const err = new Error(`הדרכים שנמצאו לא עוברות בכביש ${missing.join(', ')}.`);
      err.roads = true; throw err;
    }
    options = matching.sort((a, b) => a.duration - b.duration).slice(0, 3).map(route => ({ route, samples: sampleRoute(route), departure: dep, ready: false }));
    active = 0;
    $('#routes-meta').textContent = 'בודק את הרוח בכל דרך…';
    renderRoutes();

    const plan = forecastPlan(options.map(o => o.samples));
    const forecasts = [];
    for (let i = 0; i < plan.locations.length; i += 50) {
      const points = plan.locations.slice(i, i + 50);
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: points.map(s => s.lat.toFixed(4)).join(','), longitude: points.map(s => s.lon.toFixed(4)).join(','), hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m', wind_speed_unit: 'kmh', timeformat: 'unixtime', timezone: 'GMT', past_days: '1', forecast_days: '8' });
      let response;
      try { response = await fetchJSON(url, 40000); }
      catch (e) { throw new Error(`הדרכים נמצאו, אבל התחזית לא התקבלה. ${e.name === 'TimeoutError' ? 'נסה שוב בעוד רגע.' : e.message}`); }
      if (myJob !== job) return;
      const batch = Array.isArray(response) ? response : [response];
      if (batch.length !== points.length) throw new Error('התקבלה תחזית חלקית, ולכן היא לא מוצגת. נסה שוב.');
      forecasts.push(...batch);
    }
    options.forEach((o, oi) => o.samples.forEach((s, si) => {
      s.epoch = dep + s.seconds * 1000;
      Object.assign(s, weatherAt(forecasts[plan.lookups[oi][si]].hourly, s.epoch, s.heading));
    }));
    options.forEach(o => { o.ready = true; o.maxCross = Math.max(...o.samples.map(s => s.crossGust)); o.maxGust = Math.max(...o.samples.map(s => s.gust)); });
    fetchedAt = Date.now();
    busy = false;
    renderRoutes();
    saveRecentTrip();
    maybeOfferInstall();
    if (document.body.dataset.view === 'ride') { active = Math.min(active, options.length - 1); renderRide(); }
  } catch (e) {
    if (myJob !== job) return;
    busy = false;
    if (!options.length) $('#routes').hidden = true;
    else renderRoutes();
    const actions = e.roads
      ? `<div class="status-actions"><button type="button" class="mini-button" data-act="all-roads">להציג את כל הדרכים</button><button type="button" class="chip" data-act="stop">${icon('plus')}נקודת מעבר על הכביש</button></div>`
      : `<div class="status-actions"><button type="button" class="mini-button" data-act="retry">${icon('refresh')}לנסות שוב</button></div>`;
    setStatus(`<b>${esc(e.message || 'משהו השתבש. נסה שוב.')}</b>${actions}`, 'error');
    $('#status [data-act="retry"]')?.addEventListener('click', calculate);
    $('#status [data-act="all-roads"]')?.addEventListener('click', () => applyRoads(''));
    $('#status [data-act="stop"]')?.addEventListener('click', addStop);
    if (document.body.dataset.view === 'ride') showPlan();
  }
}

function barcode(o) {
  if (!o.ready) return '<div class="barcode loading"></div>';
  return `<div class="barcode" aria-hidden="true">${o.samples.map(s => `<i class="${band(s.crossGust)}" style="background:var(--c)"></i>`).join('')}</div>`;
}
function renderRoutes() {
  if (!options.length) return;
  const fastest = options[0].route.duration;
  const allReady = options.every(o => o.ready);
  const calmest = allReady && options.length > 1 ? options.reduce((b, o, i) => o.maxCross < options[b].maxCross - 2 ? i : b, 0) : -1;
  $('#routes-meta').textContent = allReady ? (options.length === 1 ? 'נמצאה דרך אחת' : `${options.length} דרכים`) : 'בודק את הרוח בכל דרך…';
  $('#route-cards').innerHTML = options.map((o, i) => {
    const minutes = Math.ceil(o.route.duration / 60), delta = Math.round((o.route.duration - fastest) / 60);
    const arrival = timeLabel(o.departure + o.route.duration * 1000);
    const tag = i === calmest ? '<span class="rc-tag best">הכי פחות רוח צד</span>' : i === 0 ? '<span class="rc-tag best">הכי מהירה</span>' : `<span class="rc-tag">${delta > 0 ? `+${delta} דק׳` : 'זמן דומה'}</span>`;
    const wind = o.ready
      ? `<span>משב צד עד <b style="color:var(--${band(o.maxCross)})">${round(o.maxCross)}</b> · משבים עד <b>${round(o.maxGust)}</b> קמ״ש</span>`
      : '<span>בודק את הרוח…</span>';
    return `<button type="button" class="route-card" data-route="${i}" ${o.ready ? '' : 'aria-disabled="true"'}>
      <div class="rc-top"><span class="rc-name">${esc(routeName(o.route))}</span>${tag}</div>
      <div class="rc-time"><strong>${minutes >= 90 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : minutes}</strong><span>${minutes >= 90 ? 'שעות' : 'דק׳'} · ${km(o.route.distance)} ק״מ · הגעה ${arrival}</span></div>
      ${barcode(o)}
      <div class="rc-wind">${wind}${o.ready ? `<span class="rc-go">לפרטים ${icon('next')}</span>` : ''}</div>
    </button>`;
  }).join('');
  $('#route-cards').querySelectorAll('[data-route]').forEach(b => b.onclick = () => { if (options[+b.dataset.route]?.ready) openRide(+b.dataset.route); });
}

/* ---------- נסיעות אחרונות ---------- */
function saveRecentTrip() {
  const trip = { points: places.map(p => p.point), roads: roadsText };
  const key = t => t.points.map(p => p.name).join('>') + '|' + t.roads;
  const list = store.get('ruach-recent-trips', []).filter(t => Array.isArray(t?.points) && t.points.every(validPoint) && key(t) !== key(trip));
  store.set('ruach-recent-trips', [trip, ...list].slice(0, 5));
}
function renderRecentTrips() {
  const list = store.get('ruach-recent-trips', []).filter(t => Array.isArray(t?.points) && t.points.length >= 2 && t.points.length <= 7 && t.points.every(validPoint));
  $('#recent-block').hidden = !list.length;
  $('#recent-trips').innerHTML = list.map((t, i) => `<button type="button" class="recent-trip" data-trip="${i}"><span class="r-icon">${icon('history')}</span><span><b>${esc(t.points[0].name)} ← ${esc(t.points.at(-1).name)}</b><small>${t.points.length > 2 ? `דרך ${esc(t.points.slice(1, -1).map(p => p.name).join(', '))}` : t.roads ? `כבישים ${esc(t.roads)}` : 'הדרך המהירה ועוד חלופות'}</small></span><span class="go">${icon('next')}</span></button>`).join('');
  $('#recent-trips').querySelectorAll('[data-trip]').forEach(b => b.onclick = () => {
    const t = list[+b.dataset.trip];
    places = t.points.map((p, i) => makePlace(i === 0 ? 'start' : i === t.points.length - 1 ? 'end' : `stop-${++seq}`, p));
    roadsText = typeof t.roads === 'string' ? t.roads : '';
    $('#roads-label').textContent = roadsLabel(); $('#open-roads').classList.toggle('active', !!roadsText);
    editing = null; renderTrip(); renderPanel(); calculate();
  });
}

function addStop() {
  if (places.length >= 7) return;
  const p = makePlace(`stop-${++seq}`);
  places.splice(places.length - 1, 0, p);
  invalidate(); renderTrip();
  requestAnimationFrame(() => $(`#in-${p.id}`)?.focus());
}

/* ---------- בחירה על המפה ---------- */
let pickTarget = null;
function openPicker(id) {
  if (!window.L) { toast('המפה לא נטענה. בדוק את החיבור לאינטרנט.'); return; }
  pickTarget = id;
  const dialog = $('#map-dialog');
  dialog.showModal();
  const anchor = places.find(p => p.id === id)?.point || places.find(p => p.point)?.point;
  if (!pickMap) {
    pickMap = L.map('pick-map', { zoomControl: false, attributionControl: true }).setView([31.9, 35.0], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pickMap);
  }
  requestAnimationFrame(() => {
    pickMap.invalidateSize();
    if (anchor) pickMap.setView([anchor.lat, anchor.lon], 12); else pickMap.setView([31.9, 35.0], 8);
  });
}
async function confirmPick() {
  const c = pickMap.getCenter(), id = pickTarget;
  $('#pick-confirm').disabled = true;
  let name = 'נקודה במפה';
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.search = new URLSearchParams({ lat: c.lat.toFixed(5), lon: c.lng.toFixed(5), format: 'jsonv2', 'accept-language': 'he', zoom: '16' });
    const r = await fetchJSON(u, 5000);
    const a = r.address || {};
    const label = r.name || a.road || a.village || a.town || a.city || '';
    const area = a.village || a.town || a.city || a.suburb || '';
    if (label) name = area && area !== label ? `${label}, ${area}` : label;
  } catch {}
  $('#pick-confirm').disabled = false;
  $('#map-dialog').close();
  choose(id, { name, lat: c.lat, lon: c.lng });
}

/* ===================== מסך רכיבה ===================== */
const ride = () => options[active];

function openRide(index) {
  active = index;
  if (document.body.dataset.view !== 'ride') history.pushState({ ride: true }, '');
  document.body.dataset.view = 'ride';
  $('#view-plan').hidden = true; $('#view-ride').hidden = false;
  $('#install-banner').hidden = true;
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderRide();
}
function showPlan() {
  stopTour();
  document.body.dataset.view = 'plan';
  $('#view-ride').hidden = true; $('#view-plan').hidden = false;
  renderRoutes();
}

function renderRide() {
  const o = ride(); if (!o?.ready) return;
  const { route, samples } = o;
  const start = places[0].point.name, end = places.at(-1).point.name;
  const minutes = Math.ceil(route.duration / 60);
  $('#ride-title').textContent = `${start} ← ${end}`;
  $('#ride-subtitle').textContent = `${routeName(route)} · ${minutes} דק׳ · ${km(route.distance)} ק״מ`;
  $('#stale-banner').hidden = Date.now() - fetchedAt < STALE_MS;

  // שורת השורה התחתונה
  const maxCross = o.maxCross, maxGust = o.maxGust, maxSpeed = Math.max(...samples.map(s => s.speed));
  const worst = samples.reduce((b, s, i) => s.crossGust > samples[b].crossGust ? i : b, 0);
  const w = samples[worst], level = band(maxCross);
  const share = t => samples.filter(s => s.crossGust >= t).length / samples.length;
  const part = f => f >= .5 ? 'ברוב הדרך' : f >= .15 ? 'בחלק מהדרך' : 'בקטע קצר';
  const title = level === 'low' ? 'רוח צד חלשה לאורך כל הדרך' : level === 'mid' ? `רוח צד מורגשת ${part(share(20))}` : `משבי צד חזקים ${part(share(35))}`;
  const sub = level === 'low' ? `משב הצד המשוער נשאר מתחת ל־20 קמ״ש. השיא: כ־${round(maxCross)} קמ״ש.` : `השיא: כ־${round(maxCross)} קמ״ש ב${esc(w.road)}, בסביבות ${timeLabel(w.epoch)} (ק״מ ${km(w.distance)}).`;
  const avgHead = samples.reduce((a, s) => a + s.head, 0) / samples.length;
  const tags = [`יציאה ${timeLabel(o.departure)} · הגעה ${timeLabel(samples.at(-1).epoch)}`];
  if (avgHead > 8) tags.push('בעיקר רוח פנים'); else if (avgHead < -8) tags.push('בעיקר רוח גב');
  $('#verdict').className = `verdict ${level}`;
  $('#verdict').innerHTML = `<span class="v-icon">${icon('wind')}</span><div><h1>${title}</h1><p>${sub}</p><div class="v-tags">${tags.map(t => `<span>${t}</span>`).join('')}</div></div>`;

  $('#metrics').innerHTML = [['רוח עד', maxSpeed, ''], ['משבים עד', maxGust, ''], ['משב צד עד', maxCross, band(maxCross)]]
    .map(([label, v, cls]) => `<div class="metric ${cls}"><small>${label}</small><b>${round(v)}</b><span>קמ״ש</span></div>`).join('');

  $('#wind-strip').innerHTML = samples.map(s => `<i class="${band(s.crossGust)}" style="flex:1"></i>`).join('');
  $('#scrubber').max = samples.length - 1;
  $('#strip-start').textContent = `${start} · ${timeLabel(samples[0].epoch)}`;
  $('#strip-end').textContent = `${timeLabel(samples.at(-1).epoch)} · ${end}`;

  const links = navigationLinks(places.map(p => p.point));
  const g = $('#nav-google');
  if (links?.google) { g.href = links.google; g.removeAttribute('aria-disabled'); } else { g.removeAttribute('href'); g.setAttribute('aria-disabled', 'true'); }
  if (links?.waze) $('#nav-waze').href = links.waze;
  $('#nav-note').textContent = `Google Maps יקבל את המוצא, היעד ונקודות המעבר; Waze ינווט ליעד מהמיקום הנוכחי. אפליקציית הניווט עשויה לבחור דרך אחרת — הרוח כאן מחושבת לדרך שבמפה.${links?.tooManyStops ? ' עם יותר משלוש נקודות מעבר, הקישור ל־Google Maps לא זמין בטלפון.' : ''}`;

  $('#sample-count').textContent = `${samples.length} נקודות`;
  $('#sample-rows').innerHTML = samples.map((s, i) => {
    const side = s.cross < 1 ? (s.head >= 0 ? 'פנים' : 'גב') : s.signedCross > 0 ? 'מימין' : 'משמאל';
    return `<tr data-row="${i}"><td><button type="button" class="row-button" data-sample="${i}">${esc(s.road)}</button><small>ק״מ ${km(s.distance)}</small></td><td>${timeLabel(s.epoch)}</td><td>${round(s.speed)}<small>מ${esc(directionName(s.direction))}</small></td><td>${round(s.gust)}</td><td><span class="pill ${band(s.crossGust)}">${round(s.crossGust)}</span><small>${side}</small></td></tr>`;
  }).join('');
  $('#sample-rows').querySelectorAll('[data-sample]').forEach(b => b.onclick = () => { stopTour(); selectSample(+b.dataset.sample, true); scrollToPoint(); });

  const spacing = km(route.distance / (samples.length - 1));
  $('#forecast-note').textContent = `נבדקה נקודה כל כ־${spacing} ק״מ, לפי שעת ההגעה המשוערת אליה. זו תחזית מודל בגובה 10 מ׳ — לא מדידה על הכביש — וזמני הנסיעה לא כוללים פקקים ועצירות. התחזית התקבלה ב־${timeLabel(fetchedAt)}; כדאי לבדוק שוב לפני היציאה.`;

  initRideMap();
  drawRideMap();
  renderChart();
  selected = -1;
  selectSample(worst, false);
}

function selectSample(index, pan) {
  const o = ride(); if (!o?.ready) return;
  const samples = o.samples;
  selected = Math.max(0, Math.min(samples.length - 1, index));
  const s = samples[selected];
  const rel = windRelation(s.direction, s.heading, s.speed);
  const level = band(s.crossGust);
  const card = $('.point-card');
  card.classList.remove('low', 'mid', 'high'); card.classList.add(level);
  $('#point-road').textContent = s.road;
  $('#point-where').textContent = `ק״מ ${km(s.distance)} · הגעה בסביבות ${timeLabel(s.epoch)}`;
  $('#point-relation').textContent = rel.visible ? rel.label : 'כמעט בלי רוח';
  $('#point-wind').textContent = round(s.speed);
  $('#point-gust').textContent = round(s.gust);
  $('#point-cross').textContent = round(s.crossGust);
  // סיבוב בדרך הקצרה ביותר, כדי שהחצים לא יסתובבו סיבוב שלם
  const diff = ((rel.relative - compassAngle) % 360 + 540) % 360 - 180;
  compassAngle += diff;
  const wind = $('#compass-wind');
  wind.style.transform = `rotate(${compassAngle}deg)`;
  wind.style.opacity = rel.visible ? '1' : '0';
  $('#point-counter').textContent = `נקודה ${selected + 1} מתוך ${samples.length}`;
  $('#scrubber').value = selected;
  $('#scrubber').setAttribute('aria-valuetext', `${s.road}, קילומטר ${km(s.distance)}, משב צד ${round(s.crossGust)} קמ״ש`);
  $('#prev-point').disabled = selected === 0;
  $('#next-point').disabled = selected === samples.length - 1;
  document.querySelectorAll('#sample-rows tr').forEach(tr => tr.classList.toggle('selected', +tr.dataset.row === selected));
  const cursor = $('#chart-cursor');
  if (cursor && chartX) { const x = chartX(s.distance); cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); }
  if (rideMap && rideLayers) {
    rideLayers.selected.clearLayers();
    L.circleMarker([s.lat, s.lon], { radius: 10, color: '#0f2a31', weight: 4, fillColor: '#ffffff', fillOpacity: 1 }).addTo(rideLayers.selected);
    if (pan) rideMap.panTo([s.lat, s.lon], { animate: true, duration: .8 });
  }
}
function scrollToPoint() {
  const card = $('.point-card');
  if (window.matchMedia('(min-width: 980px)').matches) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const top = card.getBoundingClientRect().top + window.scrollY - $('.ride-map-wrap').offsetHeight - 10;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/* ---------- מפה ---------- */
function initRideMap() {
  if (rideMap || !window.L) return;
  rideMap = L.map('ride-map', { zoomControl: false, attributionControl: true, scrollWheelZoom: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(rideMap);
  rideLayers = { alt: L.layerGroup().addTo(rideMap), route: L.layerGroup().addTo(rideMap), wind: L.layerGroup().addTo(rideMap), ends: L.layerGroup().addTo(rideMap), selected: L.layerGroup().addTo(rideMap) };
  new ResizeObserver(() => rideMap.invalidateSize()).observe($('#ride-map'));
}
const colorOf = level => getComputedStyle(document.documentElement).getPropertyValue(`--${level}`).trim() || '#2a9d7f';
function fitRoute() {
  const o = ride(); if (!rideMap || !o) return;
  const coords = o.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  rideMap.fitBounds(L.latLngBounds(coords), { paddingTopLeft: [24, 72], paddingBottomRight: [24, 48], maxZoom: 14 });
}
function drawRideMap() {
  if (!rideMap) return;
  const o = ride();
  Object.values(rideLayers).forEach(l => l.clearLayers());
  options.forEach((alt, i) => {
    if (i === active) return;
    L.polyline(alt.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]), { color: '#7d8f92', weight: 5, opacity: .7, dashArray: '2 9' })
      .addTo(rideLayers.alt).bindTooltip(`${routeName(alt.route)} · ${Math.ceil(alt.route.duration / 60)} דק׳`).on('click', () => { active = i; renderRide(); });
  });
  const coords = o.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  L.polyline(coords, { color: '#ffffff', weight: 10, opacity: .95 }).addTo(rideLayers.route);
  let offset = 0, si = 0;
  for (const leg of o.route.legs) for (const step of leg.steps) {
    while (si < o.samples.length - 1 && o.samples[si + 1].distance < offset + step.distance / 2) si++;
    L.polyline(step.geometry.coordinates.map(([lon, lat]) => [lat, lon]), { color: colorOf(band(o.samples[si].crossGust)), weight: 6, opacity: 1 }).addTo(rideLayers.route);
    offset += step.distance;
  }
  const every = Math.max(1, Math.ceil(o.samples.length / 6));
  o.samples.forEach((s, i) => {
    if (i % every !== 0 || i === 0) return;
    const html = `<div class="wind-marker ${band(s.crossGust)}"><svg viewBox="0 0 24 24" style="transform:rotate(${s.direction + 180}deg)"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>${round(s.crossGust)}</div>`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: [46, 26], iconAnchor: [23, 13] }), keyboard: false })
      .addTo(rideLayers.wind).on('click', () => { stopTour(); selectSample(i, false); scrollToPoint(); });
  });
  places.forEach((p, i) => {
    const kind = i === 0 ? 'start' : i === places.length - 1 ? 'end' : 'stop';
    const label = kind === 'start' ? 'א' : kind === 'end' ? 'ב' : i;
    L.marker([p.point.lat, p.point.lon], { icon: L.divIcon({ className: '', html: `<div class="end-marker ${kind}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: false, interactive: false }).addTo(rideLayers.ends);
  });
  requestAnimationFrame(() => { rideMap.invalidateSize(); fitRoute(); });
  setTimeout(() => { rideMap.invalidateSize(); fitRoute(); }, 350);
}

/* ---------- גרף ---------- */
let chartX = null;
function renderChart() {
  const o = ride(); if (!o?.ready) return;
  const s = o.samples, el = $('#chart');
  const W = Math.max(260, Math.round(el.clientWidth || 320)), H = 150, padL = 6, padR = 30, top = 10, bottom = 26;
  const total = s.at(-1).distance;
  const max = Math.max(10, Math.ceil(Math.max(...s.map(x => x.gust)) / 10) * 10);
  // ההתחלה בצד ימין, כמו כיוון הקריאה
  const x = d => +(W - padR - d / total * (W - padR - padL)).toFixed(1);
  const y = v => +(H - bottom - v / max * (H - top - bottom)).toFixed(1);
  chartX = x;
  const line = key => s.map(p => `${x(p.distance)},${y(p[key])}`).join(' ');
  const grid = [0, max / 2, max].map(n => `<line x1="${padL}" x2="${W - padR}" y1="${y(n)}" y2="${y(n)}" stroke="var(--line)"/><text x="${W - padR + 6}" y="${y(n) + 4}">${n}</text>`).join('');
  const mid = s[Math.floor(s.length / 2)];
  const labels = [[s[0], 'start'], [mid, 'middle'], [s.at(-1), 'end']].map(([p, a]) => `<text x="${x(p.distance)}" y="${H - 6}" text-anchor="${a === 'start' ? 'end' : a === 'end' ? 'start' : 'middle'}">${timeLabel(p.epoch)}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" direction="ltr" role="img" aria-label="גרף מהירות הרוח והמשבים לאורך הדרך">
    ${grid}
    <polygon points="${x(0)},${y(0)} ${line('speed')} ${x(total)},${y(0)}" fill="var(--accent)" fill-opacity=".12"/>
    <polyline points="${line('gust')}" fill="none" stroke="var(--mid)" stroke-width="2" stroke-dasharray="5 4"/>
    <polyline points="${line('speed')}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <line id="chart-cursor" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/>
    ${labels}
  </svg>`;
}

/* ---------- נסיעה וירטואלית ---------- */
function stopTour() {
  if (!tourTimer) return;
  clearInterval(tourTimer); tourTimer = null;
  $('#play-tour').setAttribute('aria-pressed', 'false');
  $('#play-tour').innerHTML = `${icon('play')}<span>נסיעה וירטואלית</span>`;
}
function startTour() {
  const o = ride(); if (!o?.ready) return;
  if (selected >= o.samples.length - 1) selectSample(0, true);
  $('#play-tour').setAttribute('aria-pressed', 'true');
  $('#play-tour').innerHTML = `${icon('pause')}<span>עצירה</span>`;
  scrollToPoint();
  if (rideMap) rideMap.setView([o.samples[selected].lat, o.samples[selected].lon], Math.max(rideMap.getZoom(), 11));
  tourTimer = setInterval(() => {
    if (!ride()?.ready || selected >= ride().samples.length - 1) { stopTour(); return; }
    selectSample(selected + 1, true);
  }, 1500);
}

/* ---------- תחזית ישנה ---------- */
function checkStale() {
  if (!fetchedAt || busy) return;
  const stale = Date.now() - fetchedAt > STALE_MS;
  if (!stale) return;
  if (document.body.dataset.view === 'ride') $('#stale-banner').hidden = false;
  else if (ready()) calculate();
}

/* ---------- התקנה ---------- */
function maybeOfferInstall() {
  if (!installPrompt || store.get('ruach-install-dismissed', false) || document.body.dataset.view === 'ride') return;
  $('#install-banner').hidden = false;
}

/* ===================== חיבור אירועים ===================== */
$('#add-stop').onclick = addStop;
$('#new-trip').onclick = () => {
  invalidate(); places = [makePlace('start'), makePlace('end')]; roadsText = ''; knownRoads = [];
  $('#roads-label').textContent = roadsLabel(); $('#open-roads').classList.remove('active');
  renderTrip(); renderRecentTrips(); startEditing('start');
};
$('#swap-trip').onclick = () => {
  places.reverse(); places[0].id = 'start'; places.at(-1).id = 'end';
  for (let i = 1; i < places.length - 1; i++) places[i].id = `stop-${++seq}`;
  renderTrip(); afterTripChange();
};
$('#open-departure').onclick = openDeparture;
$('#dep-apply').onclick = () => applyDeparture({ mode: 'at', date: $('#dep-day').value, time: $('#dep-time').value });
$('#open-roads').onclick = openRoads;
$('#roads-input').addEventListener('input', renderRoadSuggest);
$('#roads-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyRoads($('#roads-input').value); } });
$('#roads-apply').onclick = () => applyRoads($('#roads-input').value);
$('#roads-clear').onclick = () => applyRoads('');
$('#pick-confirm').onclick = confirmPick;
$('#open-about').onclick = () => $('#about-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
  if (e.target !== d || d.id === 'map-dialog') return;
  const r = d.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
}));
document.addEventListener('pointerdown', e => {
  if (editing && !e.target.closest('#trip-card, #search-panel, dialog')) stopEditing();
});

$('#ride-back').onclick = () => { if (history.state?.ride) history.back(); else showPlan(); };
window.addEventListener('popstate', () => { if (document.body.dataset.view === 'ride') showPlan(); });
$('#fit-route').onclick = fitRoute;
$('#scrubber').addEventListener('input', e => { stopTour(); selectSample(+e.target.value, true); });
$('#prev-point').onclick = () => { stopTour(); selectSample(selected - 1, true); };
$('#next-point').onclick = () => { stopTour(); selectSample(selected + 1, true); };
$('#play-tour').onclick = () => tourTimer ? stopTour() : startTour();
$('#refresh-forecast').onclick = () => { $('#stale-banner').hidden = true; calculate(); };
new ResizeObserver(() => { if (document.body.dataset.view === 'ride' && ride()?.ready) { renderChart(); selectSample(selected, false); } }).observe($('#chart'));

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
$('#install-now').onclick = async () => {
  $('#install-banner').hidden = true;
  if (!installPrompt) { $('#about-dialog').showModal(); return; }
  await installPrompt.prompt(); installPrompt = null;
};
$('#install-dismiss').onclick = () => { $('#install-banner').hidden = true; store.set('ruach-install-dismissed', true); };
window.addEventListener('appinstalled', () => { $('#install-banner').hidden = true; toast('נוסף למסך הבית 👍'); });

const refreshOnline = () => { $('#offline-banner').hidden = navigator.onLine; };
window.addEventListener('online', refreshOnline); window.addEventListener('offline', refreshOnline);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStale(); });
setInterval(checkStale, 60000);

/* ---------- הפעלה ---------- */
history.replaceState(null, '');
renderTrip(); renderRecentTrips(); refreshOnline();
if ($('#recent-block').hidden) startEditing('start');
$('#departure-label').textContent = departureLabel();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
