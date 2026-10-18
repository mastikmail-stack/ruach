import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/masti/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.runtime.cjs');
const {chromium}=require('playwright');
const useFixtures=process.argv.includes('--fixtures');
const seedRoutes=JSON.parse(await readFile('artifacts/live-route.json','utf8'));
const seedWeather=JSON.parse(await readFile('artifacts/live-weather.json','utf8'));
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const errors=[];
function weatherFixture(url,seed,broken=false){
 const u=new URL(url),lats=u.searchParams.get('latitude').split(',').map(Number),lons=u.searchParams.get('longitude').split(',').map(Number);
 return lats.map((lat,i)=>{
  const nearest=seed.reduce((best,w)=>(w.latitude-lat)**2+(w.longitude-lons[i])**2<(best.latitude-lat)**2+(best.longitude-lons[i])**2?w:best,seed[0]);
  const result=structuredClone(nearest);if(broken&&i===0)result.hourly.wind_gusts_10m=result.hourly.wind_gusts_10m.map(()=>null);return result;
 });
}
async function installFixtures(context,routes,weather,broken=()=>false){
 await context.route('https://routing.openstreetmap.de/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(routes)}));
 await context.route('https://api.open-meteo.com/v1/forecast**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(weatherFixture(r.request().url(),weather,broken()))}));
}
async function fillJourney(page){
 await page.locator('#flow-fields input').fill('תל אביב');await page.locator('#flow-fields .suggestions button').filter({hasText:/^תל אביב$/}).click();
 assert.equal(await page.locator('body').getAttribute('data-flow'),'destination');
 assert.equal(await page.locator('#flow-title').innerText(),'לאן נוסעים?');
 await page.locator('#flow-fields input').fill('ירושלים');await page.locator('#flow-fields .suggestions button').filter({hasText:/^ירושלים$/}).click();
 await page.waitForFunction(()=>!document.querySelector('#results').hidden||document.querySelector('#flow-status').classList.contains('error'),{},{timeout:90000});
 assert.equal(await page.locator('#results').getAttribute('hidden'),null,await page.locator('#flow-status').innerText());
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Jerusalem',serviceWorkers:'block'});
 if(useFixtures)await installFixtures(context,seedRoutes,seedWeather);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let routeData=seedRoutes,weatherData=seedWeather,weatherRequests=0;
 page.on('response',async r=>{if(r.url().includes('routed-car/route/'))try{routeData=await r.json();}catch{};if(r.url().startsWith('https://api.open-meteo.com/v1/forecast')){weatherRequests++;if(!useFixtures)try{weatherData=await r.json();}catch{}}});
 await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('#flow-fields input').count(),1);assert.equal(await page.locator('.shell').isVisible(),false);assert.equal(await page.locator('#flow-title').innerText(),'מאיפה יוצאים?');
 await page.screenshot({path:'artifacts/desktop-origin.png',fullPage:true});
 await fillJourney(page);
 assert.ok(await page.locator('[data-route-option]').count()>=1);
 await page.screenshot({path:'artifacts/desktop-routes.png',fullPage:true});
 await page.locator('[data-route-option="0"]').click();
 assert.equal(await page.locator('body').getAttribute('data-flow'),'ride');
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('.planner').isVisible(),false);
 assert.ok(await page.locator('.leaflet-overlay-pane svg').evaluate(e=>e.getBoundingClientRect().width)>300);
 await page.screenshot({path:'artifacts/desktop-ride.png',fullPage:true});
 const samples=await page.locator('#segment-rows tr').count();assert.ok(samples>=3&&samples<=50);
 await page.locator('#route-scrubber').focus();await page.locator('#route-scrubber').press('Home');assert.equal(await page.locator('#previous-point').isDisabled(),true);
 await page.locator('#next-point').click();assert.equal(await page.locator('#route-scrubber').inputValue(),'1');
 await page.locator('#play-ride').click();await page.waitForTimeout(2000);assert.equal(await page.locator('#play-ride').getAttribute('aria-pressed'),'true');
 await page.locator('#play-ride').click();const paused=await page.locator('#route-scrubber').inputValue();await page.waitForTimeout(1900);assert.equal(await page.locator('#route-scrubber').inputValue(),paused);
 const g=new URL(await page.locator('#google-navigation').getAttribute('href')),w=new URL(await page.locator('#waze-navigation').getAttribute('href'));assert.equal(g.searchParams.get('api'),'1');assert.equal(w.searchParams.get('vehicle_type'),'motorcycle');
 if(await page.locator('[data-route-option]').count()>1){
  const previousRequests=weatherRequests;await page.locator('#change-route').click();await page.locator('[data-route-option="1"]').click();assert.equal(await page.locator('[data-route-option="1"]').getAttribute('aria-pressed'),'true');assert.equal(weatherRequests,previousRequests);
 }
 await page.locator('#data-details summary').click();await page.locator('[data-sample="1"]').click();assert.equal(await page.locator('.leaflet-popup').count(),1);
 if(!useFixtures){await writeFile('artifacts/live-route.json',JSON.stringify(routeData));await writeFile('artifacts/live-weather.json',JSON.stringify(weatherData));}
 console.log(JSON.stringify({check:useFixtures?'wizard and route choices with test replay':'live routes and forecasts',routes:routeData.routes.length,samples,weatherRequests}));
 await context.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:'Asia/Jerusalem',serviceWorkers:'block'});
 let broken=false;await installFixtures(mobile,routeData,weatherData,()=>broken);
 const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 await phone.screenshot({path:'artifacts/mobile-origin.png',fullPage:true});assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await fillJourney(phone);await phone.screenshot({path:'artifacts/mobile-routes.png',fullPage:true});await phone.locator('[data-route-option="0"]').click();await phone.waitForTimeout(800);
 await phone.locator('.rider-panel').screenshot({path:'artifacts/mobile-inspector.png'});assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await phone.locator('#data-details').getAttribute('open'),null);
 await phone.locator('#change-route').click();await phone.locator('#flow-refine').click();await phone.locator('#preferred-roads').fill('999999');await phone.locator('#apply-refinement').click();
 await phone.waitForFunction(()=>document.querySelector('#flow-status').classList.contains('error'));assert.match(await phone.locator('#flow-status').innerText(),/אינן כוללות/);assert.equal(await phone.locator('#results').getAttribute('hidden'),'');
 await phone.locator('#flow-refine').click();await phone.locator('#preferred-roads').fill('');broken=true;await phone.locator('#apply-refinement').click();await phone.waitForFunction(()=>document.querySelector('#flow-status').classList.contains('error'));assert.match(await phone.locator('#flow-status').innerText(),/חסרים נתוני רוח/);
 broken=false;await phone.locator('#flow-refine').click();await phone.locator('#add-map-stop').click();await phone.locator('#map').click({position:{x:180,y:160}});await phone.waitForTimeout(500);assert.match(await phone.locator('[data-place^="stop-"] input').inputValue(),/מעבר במפה/);
 console.log('Mobile progressive flow, route switching, animation pause, navigation links, road mismatch, missing weather and map waypoint verified.');
 await mobile.setOffline(true);await phone.waitForTimeout(200);assert.equal(await phone.locator('#offline-banner').getAttribute('hidden'),null);
 assert.deepEqual(errors,[]);await mobile.close();console.log('No browser page errors.');
}finally{await browser.close();}
