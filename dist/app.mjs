import { ZONE, localParts, addDays, departureEpoch, validateDeparture, parseRoads, chooseRoute, sampleRoute, roadRefs, weatherAt, band, bandColor, directionName } from './core.mjs';

const $ = q => document.querySelector(q);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const round = n => Math.round(n);
const km = n => (n / 1000).toLocaleString('he-IL', {maximumFractionDigits:1});
const timeLabel = epoch => new Intl.DateTimeFormat('he-IL', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle:'h23' }).format(new Date(epoch));
const dateLabel = epoch => new Intl.DateTimeFormat('he-IL', { timeZone: ZONE, weekday:'short',day:'numeric',month:'numeric' }).format(new Date(epoch));
const CITIES = [
 ['תל אביב',32.0853,34.7818],['ירושלים',31.7683,35.2137],['חיפה',32.7940,34.9896],['באר שבע',31.2520,34.7915],['אילת',29.5577,34.9519],['נתניה',32.3215,34.8532],['אשדוד',31.8044,34.6553],['אשקלון',31.6688,34.5743],['טבריה',32.7940,35.5310],['צפת',32.9646,35.4960],['נהריה',33.0059,35.0941],['עכו',32.9281,35.0820],['מצפה רמון',30.6102,34.8019],['ערד',31.2588,35.2120],['בית שמש',31.7470,34.9880],['בית שאן',32.4971,35.4961],['ראש פינה',32.9689,35.5426],['זכרון יעקב',32.5707,34.9535],['חדרה',32.4340,34.9197],['עפולה',32.6091,35.2892],['כרמיאל',32.9147,35.2924],['קריית שמונה',33.2073,35.5721],['רחובות',31.8948,34.8113],['ראשון לציון',31.9730,34.7925],['פתח תקווה',32.0840,34.8878],['הרצליה',32.1663,34.8433],['רעננה',32.1848,34.8713],['מודיעין',31.8969,35.0104],['לטרון',31.8377,34.9788],['נס הרים',31.7456,35.0586],['בר גיורא',31.7292,35.0715],['בית גוברין',31.6133,34.8940],['עין גדי',31.4530,35.3837],['קצרין',32.9909,35.6886],['דימונה',31.0680,35.0331]
].map(([name, lat, lon]) => ({name, lat, lon}));
const makeLocation = (id, point = null) => ({id, point, text: point?.name || ''});
let seq = 0;
let places = [makeLocation('start', CITIES[0]), makeLocation('end', CITIES[1])];
let map, markerLayer, routeLayer, windLayer, selectedLayer, currentRoute, analysis;
let picking = null, busy = false, installPrompt = null, toastTimer;
let currentJob = 0, searchSeq = 0;
const requestCache = new Map();

function setStatus(message, type = '') {
  $('#status').textContent = message;
  $('#status').className = `status ${type}`;
  $('#status').hidden = !message;
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, 4500);
}
function dirty() {
  currentJob++; analysis = null; currentRoute = null;
  $('#results').hidden = true; $('#getting-started').hidden = false;
  routeLayer?.clearLayers(); windLayer?.clearLayers(); selectedLayer?.clearLayers();
  $('#map-state').className = 'live-pill'; $('#map-state').innerHTML = '<i></i>ממתין למסלול';
  $('#map-empty').hidden = false; setStatus('');
}
function drawMarkers() {
  markerLayer?.clearLayers();
  if (!map) return;
  places.forEach((p, i) => {
    if (!p.point) return;
    const label = i === 0 ? 'א' : i === places.length - 1 ? 'ב' : i;
    L.marker([p.point.lat,p.point.lon], {icon:L.divIcon({className:'',html:`<div class="point-marker ${i > 0 && i < places.length - 1 ? 'stop' : ''}">${label}</div>`,iconSize:[28,28],iconAnchor:[14,14]})}).addTo(markerLayer).bindTooltip(esc(p.point.name),{direction:'top'});
  });
}
function pickPoint(place) {
  if (!map) { toast('המפה לא זמינה כרגע. אפשר לבחור יישוב בחיפוש.'); return; }
  picking = place.id; document.querySelectorAll('.suggestions').forEach(s => s.hidden = true);
  $('#map-pick span').textContent = `לחץ במפה לבחירת ${place.id === 'start' ? 'המוצא' : place.id === 'end' ? 'היעד' : 'נקודת מעבר'}`;
  $('#map-pick').hidden = false; $('#map').classList.add('picking');
  $('#map').scrollIntoView({behavior:'smooth',block:'center'});
}
function stopPicking() { picking = null; $('#map-pick').hidden = true; $('#map').classList.remove('picking'); }
function selectPoint(place, point) {
  dirty(); place.point = point; place.text = point.name; renderPlaces(); drawMarkers();
  map?.panTo([point.lat,point.lon]);
}
function renderPlaces() {
  $('#locations').innerHTML = places.map((p, i) => {
    const start = i === 0, end = i === places.length - 1;
    const label = start ? 'מאיפה יוצאים?' : end ? 'לאן נוסעים?' : `נקודת מעבר ${i}`;
    return `<div class="location-row ${!start && !end ? 'stop-row' : ''}" data-place="${p.id}"><div class="location-label"><label for="input-${p.id}"><span class="point-dot ${end ? 'end' : start ? '' : 'stop'}"></span> ${label}</label><div class="location-tools">${start ? `<button type="button" data-locate title="המיקום שלי">המיקום שלי</button>` : !end ? `<button type="button" data-remove aria-label="הסרת נקודת מעבר ${i}">הסרה</button>` : ''}</div></div><div class="location-input-wrap"><input id="input-${p.id}" value="${esc(p.text)}" placeholder="חיפוש יישוב" autocomplete="off" aria-label="${label}" aria-autocomplete="list" aria-expanded="false" aria-controls="suggest-${p.id}"><button type="button" data-search aria-label="חיפוש ${label}" title="חיפוש יישוב">${icon('search')}</button><button type="button" data-pick aria-label="בחירת ${label} במפה" title="בחירה במפה">${icon('pin')}</button></div><div class="suggestions" id="suggest-${p.id}" hidden></div></div>`;
  }).join('');
  places.forEach(p => {
    const row = $(`[data-place="${p.id}"]`), input = row.querySelector('input');
    const suggestions = row.querySelector('.suggestions');
    function show(list, extra = '') {
      suggestions.innerHTML = list.map((x,i) => `<button type="button" data-result="${i}">${esc(x.name)}${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</button>`).join('') + extra;
      suggestions.hidden = false; input.setAttribute('aria-expanded','true');
      suggestions.querySelectorAll('[data-result]').forEach(b => b.onclick = () => selectPoint(p,list[+b.dataset.result]));
    }
    const localSuggestions = () => {
      const q = input.value.trim();
      const list = CITIES.filter(c => !q || c.name.includes(q)).slice(0,6);
      show(list, `<div class="suggestion-note">${list.length ? 'ליישוב נוסף, לחץ על זכוכית המגדלת.' : 'לחץ על זכוכית המגדלת לחיפוש יישוב, או בחר נקודה במפה.'}</div>`);
    };
    input.addEventListener('focus',localSuggestions);
    input.addEventListener('input',() => { searchSeq++; p.point = null; p.text = input.value; dirty(); drawMarkers(); localSuggestions(); });
    input.addEventListener('keydown',e => {
      if (e.key === 'Enter') { e.preventDefault(); row.querySelector('[data-search]').click(); }
      if (e.key === 'Escape') { suggestions.hidden = true; input.setAttribute('aria-expanded','false'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestions.querySelector('button')?.focus(); }
    });
    row.querySelector('[data-pick]').onclick = () => pickPoint(p);
    row.querySelector('[data-search]').onclick = async () => {
      const q = input.value.trim();
      if (q.length < 2) { toast('כתוב לפחות שתי אותיות לחיפוש יישוב.'); return; }
      const key = ++searchSeq; suggestions.hidden = false; input.setAttribute('aria-expanded','true');
      suggestions.innerHTML = '<div class="suggestion-note">מחפש יישובים…</div>';
      try {
        let results = requestCache.get(q);
        if (!results) {
          const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
          url.search = new URLSearchParams({name:q,count:'7',language:'he',countryCode:'IL'});
          const data = await fetchJSON(url, 18000);
          results = (data.results || []).map(r => ({name:r.name,lat:r.latitude,lon:r.longitude,detail:r.admin1 || r.country}));
          requestCache.set(q,results);
        }
        if (key !== searchSeq || !row.isConnected) return;
        show(results, results.length ? '' : '<div class="suggestion-note">לא נמצא יישוב. אפשר לבחור כל נקודה במפה, כולל צומת או קטע כביש.</div>');
      } catch { if (key === searchSeq && row.isConnected) suggestions.innerHTML = '<div class="suggestion-note">החיפוש אינו זמין כרגע. נסה יישוב מהרשימה או בחר נקודה במפה.</div>'; }
    };
    row.querySelector('[data-remove]')?.addEventListener('click',() => { if(picking === p.id) stopPicking(); places = places.filter(x => x !== p); dirty(); renderPlaces(); drawMarkers(); });
    row.querySelector('[data-locate]')?.addEventListener('click',() => {
      if (!navigator.geolocation) { toast('הדפדפן אינו תומך במיקום. אפשר לבחור מוצא במפה.'); return; }
      toast('ממתין לאישור גישה למיקום…');
      navigator.geolocation.getCurrentPosition(pos => {
        if(busy) return;
        selectPoint(p,{name:'המיקום שלי',lat:pos.coords.latitude,lon:pos.coords.longitude});
      },() => toast('לא התקבל מיקום. אפשר לאשר הרשאת מיקום או לבחור מוצא במפה.'),{timeout:15000,maximumAge:60000,enableHighAccuracy:true});
    });
  });
  $('#add-stop').disabled = places.length >= 7;
}
async function fetchJSON(url, timeout = 30000) {
  const response = await fetch(url, {signal:AbortSignal.timeout(timeout),cache:'no-store'});
  if (!response.ok) throw new Error(response.status === 429 ? 'השירות עמוס או שמגבלת הבקשות הושגה. המתן מעט ונסה שוב.' : 'שירות הנתונים אינו זמין כרגע. נסה שוב בעוד מעט.');
  return response.json();
}
function initMap() {
  if (!window.L) { $('#map-empty b').textContent = 'המפה לא נטענה'; $('#map-empty>span:last-child').textContent = 'אפשר עדיין לבחור יישובים ולקבל תחזית בטבלה'; return; }
  map = L.map('map',{zoomControl:false,scrollWheelZoom:false}).setView([31.94,34.96],8);
  L.control.zoom({position:'topleft'}).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  markerLayer = L.layerGroup().addTo(map); routeLayer = L.layerGroup().addTo(map); windLayer = L.layerGroup().addTo(map); selectedLayer = L.layerGroup().addTo(map);
  map.on('click',e => {
    if(!picking || busy) return;
    const p = places.find(p => p.id === picking); if (!p) return;
    const isStop = p.id !== 'start' && p.id !== 'end';
    const name = `${isStop ? 'מעבר במפה' : p.id === 'start' ? 'מוצא במפה' : 'יעד במפה'} (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`;
    stopPicking(); selectPoint(p,{name,lat:e.latlng.lat,lon:e.latlng.lng});
  });
  drawMarkers();
  new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
}
function drawRoute(route, withWeather = false) {
  if (!map) return;
  routeLayer.clearLayers();
  const coords = route.geometry.coordinates.map(([lon,lat]) => [lat,lon]);
  L.polyline(coords,{color:'white',weight:9,opacity:.95}).addTo(routeLayer);
  if (!withWeather) L.polyline(coords,{color:'#365c62',weight:5,opacity:.9}).addTo(routeLayer);
  else {
    let offset = 0, segmentIndex = 0;
    for (const leg of route.legs) for (const step of leg.steps) {
      while(segmentIndex < analysis.samples.length - 1 && analysis.samples[segmentIndex + 1].distance < offset + step.distance / 2) segmentIndex++;
      L.polyline(step.geometry.coordinates.map(([lon,lat]) => [lat,lon]),{color:bandColor(analysis.samples[segmentIndex].crossGust),weight:5,opacity:.95}).addTo(routeLayer);
      offset += step.distance;
    }
  }
  map.fitBounds(L.latLngBounds(coords),{padding:[35,35],maxZoom:14});
}
function popupHTML(s) {
  return `<div class="wind-popup"><b>${esc(s.road)}</b><br><small>ק״מ ${km(s.distance)} · ${dateLabel(s.epoch)} ${timeLabel(s.epoch)}</small><br>רוח ${round(s.speed)} קמ״ש, מ${esc(directionName(s.direction))}<br>משב ${round(s.gust)} קמ״ש<br>רוח צד ${round(s.cross)} קמ״ש<br><b>משב צד משוער ${round(s.crossGust)} קמ״ש</b></div>`;
}
function drawWindPoints() {
  windLayer?.clearLayers(); if (!map) return;
  analysis.samples.forEach((s,i) => {
    if (i % Math.max(1,Math.ceil(analysis.samples.length / 12)) !== 0 && i !== analysis.samples.length - 1) return;
    L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',html:`<div class="wind-marker" style="border-color:${bandColor(s.crossGust)};color:${bandColor(s.crossGust)}">${round(s.crossGust)}</div>`,iconSize:[28,28],iconAnchor:[14,14]})}).addTo(windLayer).bindPopup(popupHTML(s));
  });
}
function focusSample(index) {
  if (!map) return;
  const s = analysis.samples[index]; selectedLayer.clearLayers();
  L.circleMarker([s.lat,s.lon],{radius:11,color:'#142b32',weight:3,fillColor:'white',fillOpacity:1}).addTo(selectedLayer).bindPopup(popupHTML(s)).openPopup();
  map.setView([s.lat,s.lon],Math.max(map.getZoom(),11));
  $('#map').scrollIntoView({behavior:'smooth',block:'center'});
}
function renderChart(samples) {
  const W=760,H=160,left=35,right=10,top=12,bottom=30;
  const max = Math.max(10,Math.ceil(Math.max(...samples.map(s => s.gust))/10)*10);
  const x = s => left + s.distance / samples.at(-1).distance * (W-left-right);
  const y = v => H-bottom - v / max * (H-top-bottom);
  const points = key => samples.map(s => `${x(s).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');
  const grid = [0,max/2,max].map(n=>`<line x1="${left}" y1="${y(n)}" x2="${W-right}" y2="${y(n)}" stroke="#e7ece3" stroke-width="1"/><text x="${left-9}" y="${y(n)+4}" text-anchor="end">${n}</text>`).join('');
  $('#wind-chart').innerHTML = `<svg class="wind-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף מהירות הרוח והמשבים לאורך המסלול בקילומטרים" preserveAspectRatio="none"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#278376" stop-opacity=".15"/><stop offset="1" stop-color="#278376" stop-opacity=".02"/></linearGradient></defs>${grid}<polygon points="${left},${y(0)} ${points('speed')} ${W-right},${y(0)}" fill="url(#chart-fill)" stroke="none"/><polyline points="${points('gust')}" fill="none" stroke="#d49a28" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><polyline points="${points('speed')}" fill="none" stroke="#278376" stroke-width="2.5" vector-effect="non-scaling-stroke"/><text x="${left}" y="${H-6}" text-anchor="start">0</text><text x="${W/2}" y="${H-6}" text-anchor="middle">${km(samples.at(-1).distance/2)} ק״מ</text><text x="${W-right}" y="${H-6}" text-anchor="end">${km(samples.at(-1).distance)}</text></svg>`;
}
function renderResults() {
  const {route,samples,departure,fetched} = analysis;
  const maxSpeed = Math.max(...samples.map(s=>s.speed));
  const maxGust = Math.max(...samples.map(s=>s.gust));
  const maxCross = Math.max(...samples.map(s=>s.crossGust));
  $('#metrics').innerHTML = [
    ['wind','רוח מרבית',maxSpeed,'מבין הנקודות שנדגמו',''],
    ['wind','משב מרבי',maxGust,'ערך שעתִי, ללא מיצוע',''],
    ['cross','משב צד מרבי משוער',maxCross,'ביחס לכיוון הכביש','featured']
  ].map(([ic,label,value,note,cl]) => `<div class="metric ${cl}">${icon(ic)}<div class="metric-label">${label}</div><div class="metric-value"><b>${round(value)}</b><span>קמ״ש</span></div><small>${note}</small></div>`).join('');
  const duration = Math.round(route.duration / 60);
  $('#result-title').textContent = 'הרוח בדרך שלך';
  $('#fetch-time').textContent = `נתונים התקבלו ב־${timeLabel(fetched)}`;
  const refs = roadRefs(route);
  $('#route-summary').innerHTML = `<span><b>${km(route.distance)} ק״מ</b></span><span>כ־<b>${duration} דקות</b> ללא תנועה ועצירות</span><span>יציאה <b>${dateLabel(departure)} ${timeLabel(departure)}</b></span><span>הגעה <b>${dateLabel(samples.at(-1).epoch)} ${timeLabel(samples.at(-1).epoch)}</b></span>${refs.length ? `<span>כבישים במסלול: <b>${refs.map(esc).join(' · ')}</b></span>` : ''}`;
  $('#sample-count').textContent = `${samples.length} נקודות בדיקה`;
  $('#segment-rows').innerHTML = samples.map((s,i)=>`<tr><td><button type="button" class="segment-button" data-sample="${i}">${esc(s.road)}</button><small>ק״מ ${km(s.distance)} · כיוון נסיעה ${esc(directionName(s.heading))}</small></td><td>${timeLabel(s.epoch)}<small>${dateLabel(s.epoch)}</small></td><td>${round(s.speed)}<small>מ${esc(directionName(s.direction))}</small></td><td>${round(s.gust)}</td><td>${round(s.cross)}<small>${s.cross < 1 ? (s.head >= 0 ? 'רוח פנים' : 'רוח גב') : s.signedCross > 0 ? 'מימין' : 'משמאל'}</small></td><td><span class="strength ${band(s.crossGust)}">${round(s.crossGust)}</span></td></tr>`).join('');
  $('#segment-rows').querySelectorAll('[data-sample]').forEach(b=>b.onclick=()=>focusSample(+b.dataset.sample));
  const spacing = km(samples.at(-1).distance / (samples.length - 1));
  $('#forecast-notes').textContent = `דגימה כל כ־${spacing} ק״מ. תחזית מודל בגובה 10 מ׳; לא מדידה מקומית. מרווחי הדגימה ורזולוציית המודל עשויים להחמיץ משבים וקטעים קצרים. זמני ההגעה הם אומדן ללא עומסים ועצירות. יש לוודא שהמסלול במפה תואם לדרך הרצויה. לפני היציאה יש לבצע בדיקה מעודכנת ולהתייחס גם לאזהרות רשמיות.`;
  renderChart(samples); $('#results').hidden = false; $('#getting-started').hidden = true; $('#map-empty').hidden = true;
  $('#map-state').className = 'live-pill ready'; $('#map-state').innerHTML = '<i></i>תחזית התקבלה';
  drawRoute(route,true); drawWindPoints();
}

async function calculate(event) {
  event.preventDefault(); if(busy) return;
  stopPicking(); document.querySelectorAll('.suggestions').forEach(s=>s.hidden=true);
  dirty();
  try {
    if (!navigator.onLine) throw new Error('אין חיבור לאינטרנט. יש להתחבר כדי לבדוק תחזית עדכנית.');
    if (places.some(p=>!p.point)) throw new Error('יש לבחור מוצא, יעד וכל נקודת מעבר מתוך תוצאות החיפוש או במפה.');
    const departure = departureEpoch($('#date').value,$('#time').value);
    validateDeparture(departure);
    const requested = parseRoads($('#roads').value);
    for (const p of places) if(p.point.lat < 29 || p.point.lat > 34 || p.point.lon < 34 || p.point.lon > 36.2) throw new Error('הגרסה הזו מיועדת למסלולים באזור ישראל. בחר נקודות באזור המפה.');
    busy = true; const job = ++currentJob; $('#planner-fields').disabled = true; $('#check-button span').textContent = 'מחשב את הדרך…'; setStatus('מחפש מסלול נסיעה וחלופות…','loading');
    const coords = places.map(p=>`${p.point.lon.toFixed(6)},${p.point.lat.toFixed(6)}`).join(';');
    const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    let data;
    try { data = await fetchJSON(url,35000); } catch(e) { throw new Error(`חישוב המסלול לא הושלם. ${e.name === 'TimeoutError' ? 'השירות לא השיב בזמן. נסה שוב.' : e.message}`); }
    if(data.code !== 'Ok') throw new Error('לא נמצא מסלול בין הנקודות. נסה להזיז נקודה קרוב לכביש.');
    if(data.waypoints?.some(w=>w.distance > 1500)) throw new Error('אחת הנקודות רחוקה יותר מ־1.5 ק״מ מכביש שניתן לנתב אליו. יש לבחור נקודה קרובה יותר לכביש.');
    const selected = chooseRoute(data.routes,requested); currentRoute = selected.route;
    drawRoute(currentRoute); $('#map-empty').hidden = true;
    if(selected.missing.length) throw new Error(`החלופות שהתקבלו אינן כוללות את כביש ${selected.missing.join(', ')}. לא חושבה תחזית למסלול הזה. הוסף נקודת מעבר על הכביש הרצוי במפה, ואז בדוק שוב.`);
    if(currentRoute.distance > 1500000) throw new Error('המסלול ארוך מדי לגרסה הזו. נסה לפצל אותו למספר רכיבות.');
    const samples = sampleRoute(currentRoute);
    setStatus(`המסלול נמצא. מביא תחזית עבור ${samples.length} נקודות בדרך…`,'loading'); $('#check-button span').textContent='בודק את הרוח…';
    const weatherURL = new URL('https://api.open-meteo.com/v1/forecast');
    weatherURL.search = new URLSearchParams({latitude:samples.map(s=>s.lat.toFixed(4)).join(','),longitude:samples.map(s=>s.lon.toFixed(4)).join(','),hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'kmh',timeformat:'unixtime',timezone:'GMT',past_days:'1',forecast_days:'8'});
    let forecasts;
    try { forecasts = await fetchJSON(weatherURL,40000); } catch(e) { throw new Error(`המסלול נמצא, אבל התחזית לא התקבלה. ${e.name === 'TimeoutError' ? 'נסה שוב בעוד מעט.' : e.message}`); }
    if(job !== currentJob) return;
    if (!Array.isArray(forecasts)) forecasts = [forecasts];
    if (forecasts.length !== samples.length) throw new Error('התקבלה תחזית חלקית. החישוב לא מוצג כדי למנוע מידע חסר. נסה שוב.');
    samples.forEach((s,i)=>{s.epoch=departure+s.seconds*1000; Object.assign(s,weatherAt(forecasts[i].hourly,s.epoch,s.heading));});
    analysis = {route:currentRoute,samples,departure,fetched:Date.now()};
    renderResults(); setStatus('התחזית מוכנה. בדוק במפה שהמסלול עובר בדרך שרצית.');
    if(matchMedia('(max-width:760px)').matches) $('#results').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e) { setStatus(e.message || 'הבדיקה לא הושלמה. נסה שוב.','error'); }
  finally { busy = false; $('#planner-fields').disabled=false; $('#check-button span').textContent='בדיקת הרוח במסלול'; $('#add-stop').disabled=places.length >=7; }
}

function setSoon() {
  const p = localParts(Math.ceil((Date.now()+30*60000)/(15*60000))*15*60000);
  $('#date').value=p.date;$('#time').value=p.time; dirty(); updateDays();
}
function updateDays() {
  const today=localParts().date;
  $('#date').min=today;$('#date').max=addDays(today,6);
  document.querySelectorAll('[data-day]').forEach(b=>b.classList.toggle('active',$('#date').value===addDays(today,+b.dataset.day)));
}
function refreshConnectivity() { $('#offline-banner').hidden=navigator.onLine; }
function expireOldForecast() {
  if(analysis && Date.now()-analysis.fetched>30*60000){dirty();setStatus('עברו יותר מ־30 דקות מאז הבדיקה. יש לבדוק מחדש לפני היציאה.','error');}
}

$('#planner-form').addEventListener('submit',calculate);
$('#add-stop').onclick=()=>{
  const p=makeLocation(`stop-${++seq}`);places.splice(places.length-1,0,p);dirty();renderPlaces();drawMarkers();
  $(`#input-${p.id}`).focus();
};
$('#swap').onclick=()=>{
  places.reverse();places[0].id='start';places.at(-1).id='end';
  for(let i=1;i<places.length-1;i++)places[i].id=`stop-${++seq}`;
  dirty();stopPicking();renderPlaces();drawMarkers();
};
$('#roads').addEventListener('input',dirty);
[$('#date'),$('#time')].forEach(el=>el.addEventListener('change',()=>{dirty();updateDays();}));
document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{const day=+b.dataset.day;$('#date').value=addDays(localParts().date,day);if(day && $('#time').value < '06:00')$('#time').value='08:00';dirty();updateDays();});
$('#soon').onclick=setSoon;
$('#map-pick button').onclick=stopPicking;
$('#fit-map').onclick=()=>{if(currentRoute) drawRoute(currentRoute,!!analysis);else {const points=places.filter(p=>p.point).map(p=>[p.point.lat,p.point.lon]);if(map&&points.length)map.fitBounds(points,{padding:[45,45],maxZoom:13});}};
document.addEventListener('click',e=>{if(!e.target.closest('.location-row'))document.querySelectorAll('.suggestions').forEach(s=>{s.hidden=true;s.parentElement.querySelector('input').setAttribute('aria-expanded','false');});});
$('#save-route').onclick=()=>{
  if(busy)return;
  if(places.some(p=>!p.point)){toast('בחר את כל נקודות המסלול לפני השמירה.');return;}
  try{localStorage.setItem('ruach-route-v1',JSON.stringify({points:places.map(p=>p.point),roads:$('#roads').value}));$('#load-route').hidden=false;toast('המסלול נשמר במכשיר הזה. התחזית תיבדק מחדש בכל שימוש.');}catch{toast('השמירה אינה זמינה בדפדפן הזה.');}
};
$('#load-route').onclick=()=>{
  if(busy)return;
  try{const saved=JSON.parse(localStorage.getItem('ruach-route-v1'));if(!Array.isArray(saved?.points)||saved.points.length<2||saved.points.length>7||saved.points.some(p=>typeof p.name!=='string'||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)))throw new Error();
    places=saved.points.map((p,i)=>makeLocation(i===0?'start':i===saved.points.length-1?'end':`stop-${++seq}`,p));$('#roads').value=typeof saved.roads==='string'?saved.roads:'';dirty();stopPicking();setSoon();renderPlaces();drawMarkers();toast('המסלול נטען. בחר שעת יציאה ובדוק תחזית עדכנית.');
  }catch{toast('לא נמצא מסלול שמור תקין.');}
};
try{$('#load-route').hidden=!localStorage.getItem('ruach-route-v1');}catch{}
$('#about-button').onclick=()=>$('#about-dialog').showModal();
$('#install-button').onclick=()=>$('#install-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#native-install').hidden=false;});
$('#native-install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==='accepted')$('#install-dialog').close();installPrompt=null;$('#native-install').hidden=true;}};
window.addEventListener('appinstalled',()=>{$('#install-button').hidden=true;toast('האפליקציה נוספה למסך הבית.');});
window.addEventListener('online',refreshConnectivity);window.addEventListener('offline',refreshConnectivity);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateDays();expireOldForecast();}});
setInterval(expireOldForecast,60000);
setSoon();renderPlaces();initMap();refreshConnectivity();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
