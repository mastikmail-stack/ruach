import { ZONE, localParts, addDays, departureEpoch, validateDeparture, parseRoads, chooseRoute, sampleRoute, roadRefs, weatherAt, band, bandColor, directionName } from './core.mjs';
import { windRelation } from './view.mjs';
import { navigationLinks, forecastPlan } from './navigation.mjs';

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
let places = [makeLocation('start'), makeLocation('end')];
let map, markerLayer, routeLayer, windLayer, selectedLayer, currentRoute, analysis;
let picking = null, busy = false, installPrompt = null, toastTimer;
let currentJob = 0, searchSeq = 0;
let selectedSample = 0;
let routeOptions=[],activeRoute=0;
let flowStage='origin',tourTimer;
let refinementChanged=false;
const requestCache = new Map();

function setStatus(message, type = '') {
  $('#status').textContent = message;
  $('#status').className = `status ${type}`;
  $('#status').hidden = !message;
  $('#flow-status').textContent=message;$('#flow-status').className=`status ${type}`;$('#flow-status').hidden=!message;
  if(type==='error'&&flowStage==='routes'){
    const retry=document.createElement('button');retry.type='button';retry.className='flow-retry';retry.textContent='בדיקה חוזרת';retry.onclick=()=>calculate({preventDefault(){}});$('#flow-status').append(retry);
  }
  document.body.classList.toggle('forecast-error',type==='error'&&routeOptions.length>0&&!analysis);
  $('.journey').setAttribute('aria-busy',String(type === 'loading'));
  if(type === 'loading') { $('#map-state').className='live-pill'; $('#map-state').innerHTML='<i></i>הבדיקה בדרך…'; }
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, 4500);
}
function dirty() {
  stopTour();
  currentJob++; analysis = null; currentRoute = null;
  routeOptions=[];activeRoute=0;$('#route-choices').hidden=true;
  $('#results').hidden = true; $('#getting-started').hidden = false;
  $('#quick-routes').hidden = false; $('#data-details').open = false;
  routeLayer?.clearLayers(); windLayer?.clearLayers(); selectedLayer?.clearLayers();
  $('#map-state').className = 'live-pill'; $('#map-state').innerHTML = '<i></i>לפני בדיקה';
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
  if(flowStage!=='ride'){$('#flow-map-host').append($('.map-panel'));$('#flow-map-dialog').showModal();requestAnimationFrame(()=>map.invalidateSize());}
  picking = place.id; document.querySelectorAll('.suggestions').forEach(s => s.hidden = true);
  $('#map-pick span').textContent = `לחץ במפה לבחירת ${place.id === 'start' ? 'המוצא' : place.id === 'end' ? 'היעד' : 'נקודת מעבר'}`;
  $('#map-pick').hidden = false; $('#map').classList.add('picking');
  $('#map').scrollIntoView({behavior:'smooth',block:'center'});
}
function stopPicking() { picking = null; $('#map-pick').hidden = true; $('#map').classList.remove('picking');if($('#flow-map-dialog').open)$('#flow-map-dialog').close(); }
function selectPoint(place, point) {
  dirty(); place.point = point; place.text = point.name; renderPlaces(); drawMarkers();
  map?.panTo([point.lat,point.lon]);
  if(flowStage==='origin'&&place.id==='start')flowTo('destination');
  else if((flowStage==='destination'&&place.id==='end')||(flowStage==='routes'&&place.id.startsWith('stop-'))){flowTo('routes');calculate({preventDefault(){}});}
}
function renderPlaces() {
  $('#flow-fields').replaceChildren();
  $('#locations').innerHTML = places.map((p, i) => {
    const start = i === 0, end = i === places.length - 1;
    const label = start ? 'מאיפה יוצאים?' : end ? 'לאן נוסעים?' : `נקודת מעבר ${i}`;
    return `<div class="location-row ${!start && !end ? 'stop-row' : ''}" data-place="${p.id}"><div class="location-label"><label for="input-${p.id}"><span class="point-dot ${end ? 'end' : start ? '' : 'stop'}"></span> ${label}</label><div class="location-tools">${start ? `<button type="button" data-locate title="המיקום שלי">המיקום שלי</button>` : !end ? `<button type="button" data-remove aria-label="הסרת נקודת מעבר ${i}">הסרה</button>` : ''}</div></div><div class="location-input-wrap"><input id="input-${p.id}" value="${esc(p.text)}" placeholder="חיפוש יישוב" autocomplete="off" aria-label="${label}" aria-autocomplete="list" aria-expanded="false" aria-controls="suggest-${p.id}"><button type="button" data-search aria-label="חיפוש ${label}" title="חיפוש יישוב">${icon('search')}</button><button type="button" data-pick aria-label="בחירת ${label} במפה" title="בחירה במפה">${icon('pin')}</button></div><div class="suggestions" id="suggest-${p.id}" hidden></div></div>`;
  }).join('');
  places.forEach(p => {
    const row = $(`[data-place="${p.id}"]`), input = row.querySelector('input');
    let searchTimer;
    const suggestions = row.querySelector('.suggestions');
    function show(list, extra = '') {
      suggestions.innerHTML = list.map((x,i) => `<button type="button" data-result="${i}">${esc(x.name)}${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</button>`).join('') + extra;
      suggestions.hidden = false; input.setAttribute('aria-expanded','true');
      suggestions.querySelectorAll('[data-result]').forEach(b => b.onclick = () => selectPoint(p,list[+b.dataset.result]));
    }
    const localSuggestions = () => {
      const q = input.value.trim();
      if(!q){suggestions.hidden=true;input.setAttribute('aria-expanded','false');return;}
      const list = CITIES.filter(c => !q || c.name.includes(q)).slice(0,6);
      show(list, `<div class="suggestion-note">${list.length ? 'ליישוב נוסף, לחץ על זכוכית המגדלת.' : 'לחץ על זכוכית המגדלת לחיפוש יישוב, או בחר נקודה במפה.'}</div>`);
    };
    input.addEventListener('focus',localSuggestions);
    input.addEventListener('input',() => {
      clearTimeout(searchTimer); searchSeq++; p.point = null; p.text = input.value; dirty(); drawMarkers(); localSuggestions();
      const q=input.value.trim();
      if(q.length>=3&&!CITIES.some(c=>c.name.includes(q))) searchTimer=setTimeout(()=>{if(input.isConnected&&document.activeElement===input)row.querySelector('[data-search]').click();},550);
    });
    input.addEventListener('keydown',e => {
      if (e.key === 'Enter') { e.preventDefault(); row.querySelector('[data-search]').click(); }
      if (e.key === 'Escape') { suggestions.hidden = true; input.setAttribute('aria-expanded','false'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestions.querySelector('button')?.focus(); }
    });
    row.querySelector('[data-pick]').onclick = () => pickPoint(p);
    row.querySelector('[data-search]').onclick = async () => {
      clearTimeout(searchTimer); const q = input.value.trim();
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
  mountFlowField();
}
async function fetchJSON(url, timeout = 30000) {
  const response = await fetch(url, {signal:AbortSignal.timeout(timeout),cache:'no-store'});
  if (!response.ok) throw new Error(response.status === 429 ? 'השירות עמוס או שמגבלת הבקשות הושגה. המתן מעט ונסה שוב.' : 'שירות הנתונים אינו זמין כרגע. נסה שוב בעוד מעט.');
  return response.json();
}
function initMap() {
  if (!window.L) { $('#map-empty b').textContent = 'המפה לא נטענה'; $('#map-empty>div>span').textContent = 'אפשר עדיין לבחור יישובים ולקבל תחזית'; return; }
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
  for(const [i,option] of routeOptions.entries()) {
    if(option.route===route)continue;
    L.polyline(option.route.geometry.coordinates.map(([lon,lat])=>[lat,lon]),{color:'#91a5a9',weight:5,opacity:.65,dashArray:'6 7'}).addTo(routeLayer).bindTooltip(`חלופה ${i+1} · כ־${Math.ceil(option.route.duration/60)} דקות`).on('click',()=>activateRoute(i));
  }
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
    if (i % Math.max(1,Math.ceil(analysis.samples.length / 8)) !== 0 && i !== analysis.samples.length - 1) return;
    L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',html:`<div class="wind-marker" style="border-color:${bandColor(s.crossGust)};color:${bandColor(s.crossGust)}"><span class="wind-mini-arrow" style="transform:rotate(${s.direction+180}deg)" aria-hidden="true">↑</span>${round(s.crossGust)}</div>`,iconSize:[44,29],iconAnchor:[22,14]})}).addTo(windLayer).bindPopup(popupHTML(s)).on('click',()=>selectSample(i));
  });
}
function selectSample(index) {
  if(!analysis)return;
  selectedSample=Math.min(analysis.samples.length-1,Math.max(0,index));
  const s=analysis.samples[selectedSample];
  const relation=windRelation(s.direction,s.heading,s.speed);
  $('#point-road').textContent=s.road;
  $('#point-location').textContent=`ק״מ ${km(s.distance)} · הגעה משוערת ${dateLabel(s.epoch)} ב־${timeLabel(s.epoch)}`;
  $('#point-direction').innerHTML=`${icon('wind')}${esc(relation.label)}`;
  $('#point-wind').textContent=round(s.speed);$('#point-gust').textContent=round(s.gust);$('#point-cross').textContent=round(s.crossGust);
  $('#point-cross').style.color=bandColor(s.crossGust);
  $('#point-explanation').textContent=relation.visible?`הרוח נושבת מ${directionName(s.direction)}, כשכיוון הרכיבה הוא ${directionName(s.heading)}. משב הצד הוא אומדן לפי כיוון הרוח השעתית.`:'כשהרוח הממוצעת חלשה מאוד, המחשת הכיוון פחות משמעותית. משבים עדיין יכולים להגיע מכיוונים אחרים.';
  $('#wind-flow').setAttribute('transform',`rotate(${relation.relative} 140 140)`);
  $('#wind-flow').style.opacity=relation.visible?'1':'0';
  $('#point-counter').textContent=`נקודה ${selectedSample+1} מתוך ${analysis.samples.length}`;
  $('#route-scrubber').max=analysis.samples.length-1;$('#route-scrubber').value=selectedSample;
  $('#route-scrubber').setAttribute('aria-valuetext',`${s.road}, קילומטר ${km(s.distance)}, משב צד ${round(s.crossGust)} קילומטר לשעה`);
  $('#scrubber-distance').textContent=`${km(s.distance)} / ${km(analysis.route.distance)} ק״מ`;
  $('#scrubber-start').textContent=places[0].point.name;$('#scrubber-end').textContent=places.at(-1).point.name;
  $('#previous-point').disabled=selectedSample===0;$('#next-point').disabled=selectedSample===analysis.samples.length-1;
  if(map){selectedLayer.clearLayers();L.circleMarker([s.lat,s.lon],{radius:12,color:'#17343d',weight:2,fillColor:'#d4ee95',fillOpacity:.7}).addTo(selectedLayer);}
}
function focusSample(index) {
  selectSample(index);
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
  const duration = Math.ceil(route.duration / 60);
  $('#result-title').textContent = 'התמונה הגדולה של הרכיבה';
  const worstIndex=samples.reduce((best,s,i)=>s.crossGust>samples[best].crossGust?i:best,0);
  const worst=samples[worstIndex];
  $('#forecast-insight').className=`forecast-insight ${band(maxCross)}`;
  $('#forecast-insight').innerHTML=`<span>${icon('cross')}</span><div><b>משב הצד הבולט במסלול: ${esc(worst.road)}</b><p>כ־${round(maxCross)} קמ״ש בק״מ ${km(worst.distance)}, בסביבות ${timeLabel(worst.epoch)}. זו הנקודה עם האומדן הגבוה ביותר מבין הנקודות שבדקנו.</p></div>`;
  $('#fetch-time').textContent = `נתונים התקבלו ב־${timeLabel(fetched)}`;
  const refs = roadRefs(route);
  $('#route-summary').innerHTML = `<span>${icon('route')}<b>${km(route.distance)} ק״מ</b></span><span>${icon('clock')}כ־<b>${duration} דקות</b></span><span>יציאה <b>${timeLabel(departure)}</b> · הגעה <b>${timeLabel(samples.at(-1).epoch)}</b></span>${refs.length ? `<span class="road-badges">כבישים בדרך ${refs.map(n=>`<span class="road-badge">${esc(n)}</span>`).join('')}</span>` : ''}`;
  $('#metrics').querySelectorAll('.metric').forEach((el,i)=>{const value=[maxSpeed,maxGust,maxCross][i];el.insertAdjacentHTML('beforeend',`<div class="metric-meter" aria-hidden="true">${Array.from({length:7},(_,j)=>`<i class="${j<Math.min(7,Math.ceil(value/60*7))?'filled':''}"></i>`).join('')}</div>`);});
  $('#sample-count').textContent = `${samples.length} נקודות בדיקה`;
  $('#segment-rows').innerHTML = samples.map((s,i)=>`<tr><td><button type="button" class="segment-button" data-sample="${i}">${esc(s.road)}</button><small>ק״מ ${km(s.distance)} · כיוון נסיעה ${esc(directionName(s.heading))}</small></td><td>${timeLabel(s.epoch)}<small>${dateLabel(s.epoch)}</small></td><td>${round(s.speed)}<small>מ${esc(directionName(s.direction))}</small></td><td>${round(s.gust)}</td><td>${round(s.cross)}<small>${s.cross < 1 ? (s.head >= 0 ? 'רוח פנים' : 'רוח גב') : s.signedCross > 0 ? 'מימין' : 'משמאל'}</small></td><td><span class="strength ${band(s.crossGust)}">${round(s.crossGust)}</span></td></tr>`).join('');
  $('#segment-rows').querySelectorAll('[data-sample]').forEach(b=>b.onclick=()=>focusSample(+b.dataset.sample));
  const spacing = km(samples.at(-1).distance / (samples.length - 1));
  $('#forecast-notes').textContent = `דגימה כל כ־${spacing} ק״מ. תחזית מודל בגובה 10 מ׳; לא מדידה מקומית. מרווחי הדגימה ורזולוציית המודל עשויים להחמיץ משבים וקטעים קצרים. זמני ההגעה הם אומדן ללא עומסים ועצירות. יש לוודא שהמסלול במפה תואם לדרך הרצויה. לפני היציאה יש לבצע בדיקה מעודכנת ולהתייחס גם לאזהרות רשמיות.`;
  renderChart(samples); $('#results').hidden = false; $('#getting-started').hidden = true; $('#quick-routes').hidden = true; $('#map-empty').hidden = true;
  $('#map-state').className = 'live-pill ready'; $('#map-state').innerHTML = '<i></i>תחזית התקבלה';
  drawRoute(route,true); drawWindPoints(); selectSample(worstIndex);
}

function renderRouteChoices() {
  if(!routeOptions.length)return;
  $('#route-choices').hidden=false;
  $('#route-options-count').textContent=routeOptions.length===1?'נמצאה דרך אחת':`${routeOptions.length} חלופות להשוואה`;
  const fastest=Math.ceil(routeOptions[0].route.duration/60);
  $('#route-option-cards').innerHTML=routeOptions.map((option,i)=>{
    const minutes=Math.ceil(option.route.duration/60),refs=roadRefs(option.route),delta=minutes-fastest;
    const cross=option.ready?Math.max(...option.samples.map(s=>s.crossGust)):null;
    const gust=option.ready?Math.max(...option.samples.map(s=>s.gust)):null;
    return `<button type="button" data-route-option="${i}" class="route-option ${i===activeRoute?'selected':''}" aria-pressed="${i===activeRoute}"><div class="option-top"><span class="option-radio"></span><b>${i===0?'המהירה באומדן':`חלופה ${i+1}`}</b><span class="option-delta">${i===0?'ללא פקקים':delta?`+${delta} דק׳`:'זמן דומה'}</span></div><div class="option-duration"><strong>${minutes}</strong><span>דקות</span><small>${km(option.route.distance)} ק״מ</small></div><div class="option-roads">${refs.length?`דרך כבישים ${refs.map(esc).join(' · ')}`:'דרכים מקומיות'}</div><div class="option-weather">${icon('wind')}${option.ready?`משבים עד ${round(gust)} · משב צד עד ${round(cross)} קמ״ש`:(busy?'בודק את הרוחות במסלול…':'תחזית עדיין לא זמינה')}</div><div class="option-open">למפה ולכיווני הרוח ${icon('arrow')}</div></button>`;
  }).join('');
  $('#route-option-cards').querySelectorAll('[data-route-option]').forEach(b=>b.onclick=()=>activateRoute(+b.dataset.routeOption));
  const links=navigationLinks(places.map(p=>p.point));
  const google=$('#google-navigation');
  if(links.google){google.href=links.google;google.removeAttribute('aria-disabled');}
  else{google.removeAttribute('href');google.setAttribute('aria-disabled','true');}
  $('#waze-navigation').href=links.waze;
  $('#navigation-note').textContent=`Google Maps מקבל את המוצא, היעד ונקודות המעבר. Waze נפתח ליעד בלבד מהמיקום הנוכחי. ייתכן שהדרך תחושב אחרת; הרוחות כאן מתייחסות למסלול המוצג במפה. יש לבחור את שעת היציאה הרצויה באפליקציית הניווט.${links.tooManyStops?' הקישור ל־Google Maps אינו זמין למסלול עם יותר משלוש נקודות מעבר בדפדפן נייד.':''}`;
}
function activateRoute(index) {
  if(busy||!routeOptions[index])return;
  const option=routeOptions[index];activeRoute=index;currentRoute=option.route;
  windLayer?.clearLayers();selectedLayer?.clearLayers();
  if(option.ready){analysis=option;renderResults();setStatus(`חלופה ${index+1} נבחרה. המפה והתחזית עודכנו לדרך הזו.`);}
  else{analysis=null;$('#results').hidden=true;drawRoute(option.route);setStatus('זו הדרך שנבחרה. התחזית לא התקבלה; אפשר לנסות לבדוק מחדש.','error');}
  renderRouteChoices();
  if(option.ready)flowTo('ride');
}

async function calculate(event) {
  event.preventDefault(); if(busy) return;
  if(flowStage==='ride')flowTo('routes');
  stopPicking(); document.querySelectorAll('.suggestions').forEach(s=>s.hidden=true);
  dirty();
  try {
    if (!navigator.onLine) throw new Error('אין חיבור לאינטרנט. יש להתחבר כדי לבדוק תחזית עדכנית.');
    places.forEach(p=>{if(!p.point){const exact=CITIES.find(c=>c.name===p.text.trim());if(exact)p.point=exact;}});
    if (places.some(p=>!p.point)) { const missing=places.find(p=>!p.point); $(`#input-${missing.id}`).focus(); throw new Error('בחר את המקום הרצוי מתוך הרשימה שמתחת לשדה, או סמן אותו במפה.'); }
    const departure = departureEpoch($('#date').value,$('#time').value);
    validateDeparture(departure);
    const requested = parseRoads($('#roads').value);
    for (const p of places) if(p.point.lat < 29 || p.point.lat > 34 || p.point.lon < 34 || p.point.lon > 36.2) throw new Error('הגרסה הזו מיועדת למסלולים באזור ישראל. בחר נקודות באזור המפה.');
    busy = true; const job = ++currentJob; $('#planner-fields').disabled = true; $('#mobile-check').disabled=true;$('#flow-back').disabled=true; $('#check-button span').textContent = 'מחשב את הדרך…'; $('#mobile-check span').textContent='מחשב את הדרך…'; setStatus('מוצא את הדרכים האפשריות ליעד שלך…','loading');
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
    routeOptions=data.routes.filter(r=>requested.every(n=>roadRefs(r).includes(n))&&r.distance<=1500000).sort((a,b)=>a.duration-b.duration).slice(0,3).map(route=>({route,samples:sampleRoute(route),departure,ready:false}));
    activeRoute=0;currentRoute=routeOptions[0].route;renderRouteChoices();drawRoute(currentRoute);
    const plan=forecastPlan(routeOptions.map(o=>o.samples));
    setStatus(`שלב 2 מתוך 2 · בודק רוחות ב־${routeOptions.length} דרכים אפשריות…`,'loading'); $('#check-button span').textContent='בודק את הרוח…'; $('#mobile-check span').textContent='בודק את הרוח…';
    const forecasts=[];
    for(let start=0;start<plan.locations.length;start+=50){
      const points=plan.locations.slice(start,start+50);
      const weatherURL = new URL('https://api.open-meteo.com/v1/forecast');
      weatherURL.search = new URLSearchParams({latitude:points.map(s=>s.lat.toFixed(4)).join(','),longitude:points.map(s=>s.lon.toFixed(4)).join(','),hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'kmh',timeformat:'unixtime',timezone:'GMT',past_days:'1',forecast_days:'8'});
      let response;
      try{response=await fetchJSON(weatherURL,40000);}catch(e){throw new Error(`הדרכים נמצאו, אבל התחזית לא התקבלה. ${e.name==='TimeoutError'?'נסה שוב בעוד מעט.':e.message}`);}
      if(job!==currentJob)return;
      const batch=Array.isArray(response)?response:[response];
      if(batch.length!==points.length)throw new Error('התקבלה תחזית חלקית. החישוב לא מוצג כדי למנוע מידע חסר. נסה שוב.');
      forecasts.push(...batch);
    }
    const fetched=Date.now();
    for(const [optionIndex,option] of routeOptions.entries()){
      option.samples.forEach((s,i)=>{s.epoch=departure+s.seconds*1000;Object.assign(s,weatherAt(forecasts[plan.lookups[optionIndex][i]].hourly,s.epoch,s.heading));});
      option.fetched=fetched;
    }
    routeOptions.forEach(o=>o.ready=true);
    analysis=routeOptions[0];renderRouteChoices();
    renderResults(); setStatus(flowStage==='routes'?'':'התחזית מוכנה. בדוק במפה שהמסלול עובר בדרך שרצית.');
    if(flowStage==='routes')$('#flow-title').textContent='באיזו דרך נוסעים?';
  } catch(e) { setStatus(e.message || 'הבדיקה לא הושלמה. נסה שוב.','error'); $('#map-state').className='live-pill'; $('#map-state').innerHTML='<i></i>הבדיקה לא הושלמה'; $('#status').scrollIntoView({behavior:'smooth',block:'nearest'}); }
  finally { busy = false; $('#planner-fields').disabled=false; $('#mobile-check').disabled=false;$('#flow-back').disabled=false; $('#check-button span').textContent='מה הרוח בדרך שלי?'; $('#mobile-check span').textContent='בדיקת הרוח'; $('#add-stop').disabled=places.length >=7; $('.journey').setAttribute('aria-busy','false');if(routeOptions.length)renderRouteChoices(); }
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
  if(analysis && Date.now()-analysis.fetched>30*60000){dirty();flowTo('destination');setStatus('עברו יותר מ־30 דקות מאז הבדיקה. יש לבדוק מחדש לפני היציאה.','error');}
}

function mountFlowField(){
  const host=$('#flow-fields');
  for(const row of [...host.children])$('#locations').append(row);
  if(flowStage==='origin'||flowStage==='destination'){
    const row=$(`[data-place="${flowStage==='origin'?'start':'end'}"]`);if(row)host.append(row);
  }
}
function flowTo(stage){
  stopTour();flowStage=stage;document.body.dataset.flow=stage;
  $('#trip-flow').hidden=stage==='ride';
  if(stage==='ride')$('.shell').insertBefore($('#offline-banner'),$('.workspace'));else $('#trip-flow').insertBefore($('#offline-banner'),$('.flow-progress'));
  const routes=stage==='routes',ride=stage==='ride';
  $('#flow-fields').hidden=routes||ride;$('#flow-continue').hidden=routes||ride;
  $('#flow-departure').hidden=stage==='origin'||ride;
  $('#flow-refine').hidden=!routes;
  $('#flow-back').hidden=stage==='origin'||ride;
  $('#flow-route-summary').hidden=!routes;
  $('#flow-routes').hidden=!routes;
  const departure=`${$('#date').value===localParts().date?'היום':$('#date').value===addDays(localParts().date,1)?'מחר':$('#date').value} ב־${$('#time').value}`;
  $('#flow-departure').textContent=`יציאה ${departure} · שינוי`;
  $('#flow-route-summary').textContent=places.every(p=>p.point)?`${places[0].point.name} ← ${places.at(-1).point.name}`:'';
  const titles={origin:['מאיפה יוצאים?','יישוב, מקום מוכר או המיקום שלך.','מתחילים בדרך שלך'],destination:['לאן נוסעים?','בחר יעד. אנחנו כבר נמצא את הדרכים והרוחות.','ועכשיו, לאן?'],routes:['באיזו דרך נוסעים?','בחר דרך כדי לראות את המפה וכיווני הרוח.','האפשרויות שלך בדרך']};
  if(!ride){
    const [title,description,kicker]=titles[stage];$('#flow-title').textContent=title;$('#flow-description').textContent=description;$('#flow-kicker').textContent=kicker;
    $('#flow-routes').append($('#route-choices'));$('#route-choices').hidden=!routes||!routeOptions.length;
    $('#route-choices').append($('.navigation-actions'));
    if(routes&&routeOptions.length)renderRouteChoices();
  }else{
    $('#route-choices').hidden=true;
    const host=$('#ride-navigation');$('.shell').insertBefore(host,$('footer'));host.append($('.navigation-actions'));
    $('#ride-trip-title').textContent=`${places[0].point.name} ← ${places.at(-1).point.name}`;
    requestAnimationFrame(()=>{map?.invalidateSize();if(currentRoute)drawRoute(currentRoute,!!analysis);});
  }
  $('#flow-status').hidden=true;
  document.querySelectorAll('.flow-progress i').forEach((el,i)=>el.classList.toggle('current',i<=({origin:0,destination:1,routes:2,ride:2}[stage])));
  mountFlowField();
  if(stage==='origin'||stage==='destination')requestAnimationFrame(()=>$('#flow-fields input')?.focus({preventScroll:true}));
  window.scrollTo({top:0,behavior:'instant'});
}
function stopTour(){
  clearInterval(tourTimer);tourTimer=null;document.body.classList.remove('touring');
  $('#play-ride').setAttribute('aria-pressed','false');$('#play-ride').innerHTML='<span aria-hidden="true">▶</span>סיור בדרך ובכיווני הרוח';
}
$('#play-ride').onclick=()=>{
  if(tourTimer){stopTour();return;}if(!analysis)return;
  if(selectedSample>=analysis.samples.length-1)selectSample(0);
  document.body.classList.add('touring');$('#play-ride').setAttribute('aria-pressed','true');$('#play-ride').innerHTML='<span aria-hidden="true">Ⅱ</span>עצירת הסיור';
  tourTimer=setInterval(()=>{if(!analysis||selectedSample>=analysis.samples.length-1){stopTour();return;}selectSample(selectedSample+1);const s=analysis.samples[selectedSample];map?.panTo([s.lat,s.lon],{animate:true,duration:1.2});},1800);
};
$('#flow-continue').onclick=()=>{
  if(busy)return;const p=places.find(p=>p.id===(flowStage==='origin'?'start':'end'));
  const exact=p.point||CITIES.find(c=>c.name===p.text.trim());
  if(exact)selectPoint(p,exact);else $('#flow-fields [data-search]').click();
};
$('#flow-back').onclick=()=>{if(!busy)flowTo(flowStage==='routes'?'destination':'origin');};
$('#change-route').onclick=()=>flowTo('routes');
$('.nav-current').addEventListener('click',e=>{e.preventDefault();flowTo('origin');});
document.querySelectorAll('.departure-edit').forEach(b=>b.onclick=()=>{
  if(busy)return;$('#flow-date').value=$('#date').value;$('#flow-date').min=$('#date').min;$('#flow-date').max=$('#date').max;$('#flow-time').value=$('#time').value;$('#departure-error').textContent='';$('#departure-dialog').showModal();
});
$('#apply-departure').onclick=()=>{
  try{validateDeparture(departureEpoch($('#flow-date').value,$('#flow-time').value));$('#date').value=$('#flow-date').value;$('#time').value=$('#flow-time').value;$('#departure-dialog').close();const reload=flowStage==='routes'||flowStage==='ride';dirty();flowTo(reload?'routes':flowStage);if(reload)calculate({preventDefault(){}});}catch(e){$('#departure-error').textContent=e.message;}
};
$('#flow-map-dialog').addEventListener('close',()=>{picking=null;$('#map-pick').hidden=true;$('#map').classList.remove('picking');$('.journey').insertBefore($('.map-panel'),$('#results'));const empty=places.filter(p=>p.id.startsWith('stop-')&&!p.point);if(empty.length){places=places.filter(p=>!empty.includes(p));renderPlaces();drawMarkers();}});
$('#flow-departure').insertAdjacentHTML('afterend','<button type="button" id="flow-refine" class="flow-departure" hidden>כבישים ונקודות מעבר</button>');
function renderFlowStops(){
  $('#flow-stop-list').innerHTML=places.slice(1,-1).map(p=>`<div class="flow-stop-chip"><span>${esc(p.point?.name||'נקודה במפה')}</span><button type="button" data-remove-stop="${p.id}" aria-label="הסרת נקודת המעבר">×</button></div>`).join('');
  $('#flow-stop-list').querySelectorAll('[data-remove-stop]').forEach(b=>b.onclick=()=>{places=places.filter(p=>p.id!==b.dataset.removeStop);refinementChanged=true;dirty();renderPlaces();drawMarkers();renderFlowStops();});
  $('#add-map-stop').disabled=places.length>=7;
}
$('#flow-refine').onclick=()=>{if(busy)return;refinementChanged=false;$('#preferred-roads').value=$('#roads').value;$('#refine-error').textContent='';renderFlowStops();$('#refine-dialog').showModal();};
$('#add-map-stop').onclick=()=>{
  if(places.length>=7)return;$('#roads').value=$('#preferred-roads').value;refinementChanged=false;$('#refine-dialog').close();
  const p=makeLocation(`stop-${++seq}`);places.splice(places.length-1,0,p);renderPlaces();drawMarkers();pickPoint(p);
};
$('#apply-refinement').onclick=()=>{try{parseRoads($('#preferred-roads').value);$('#roads').value=$('#preferred-roads').value;refinementChanged=false;$('#refine-dialog').close();calculate({preventDefault(){}});}catch(e){$('#refine-error').textContent=e.message;}};
$('#refine-dialog').addEventListener('close',()=>{if(refinementChanged&&!busy){refinementChanged=false;calculate({preventDefault(){}});}});

$('#planner-form').addEventListener('submit',calculate);
$('#route-scrubber').addEventListener('input',e=>{stopTour();selectSample(+e.target.value);});
$('#previous-point').onclick=()=>{stopTour();selectSample(selectedSample-1);};
$('#next-point').onclick=()=>{stopTour();selectSample(selectedSample+1);};
$('#back-to-planner').onclick=()=>flowTo('origin');
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{
  if(busy)return;
  const names={jerusalem:['תל אביב','ירושלים'],coast:['תל אביב','חיפה'],desert:['באר שבע','מצפה רמון']}[b.dataset.preset];
  places=names.map((name,i)=>makeLocation(i?'end':'start',CITIES.find(c=>c.name===name)));
  $('#roads').value='';dirty();stopPicking();renderPlaces();drawMarkers();$('#fit-map').click();$('#planner').scrollIntoView({behavior:'smooth',block:'start'});toast('הכיוון נבחר. אפשר לשנות את הדרך או לבדוק את הרוח.');
});
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
setSoon();renderPlaces();initMap();refreshConnectivity();flowTo('origin');
$('.visual-caption').textContent='המחשת רכיבה · החצים מראים לאן האוויר נע';
$('.rider-diagram').setAttribute('aria-label','המחשת אופנוע וכיוון תנועת האוויר ביחס לרוכב');
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
