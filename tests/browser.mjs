import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const runtimeRequire=createRequire('C:/Users/masti/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.runtime.cjs');
const {chromium}=runtimeRequire('playwright');
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const failures=[];
const useFixtures=process.argv.includes('--fixtures');
try{
 const context=await browser.newContext({viewport:{width:1440,height:1060},timezoneId:'Asia/Jerusalem'});
 if(useFixtures){
  const route=await readFile('artifacts/live-route.json','utf8');
  const weather=await readFile('artifacts/live-weather.json','utf8');
  await context.route('https://routing.openstreetmap.de/**',r=>r.fulfill({status:200,contentType:'application/json',body:route}));
  await context.route('https://api.open-meteo.com/v1/forecast**',r=>r.fulfill({status:200,contentType:'application/json',body:weather}));
 }
 const page=await context.newPage();
 page.on('pageerror',e=>failures.push(e.message));
 let routeData,weatherData;
 page.on('response',async r=>{
  if(r.url().includes('routed-car/route/')){try{routeData=await r.json();}catch{}}
  if(r.url().startsWith('https://api.open-meteo.com/v1/forecast')){try{weatherData=await r.json();}catch{}}
 });
 await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof window.L==='object');
 await page.waitForFunction(()=>document.querySelectorAll('.leaflet-tile-loaded').length>0);
 await page.screenshot({path:'artifacts/desktop-initial.png',fullPage:true});
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 await page.locator('#check-button').click();
 await page.waitForFunction(()=>!document.querySelector('#results').hidden||document.querySelector('#status').classList.contains('error'),{},{timeout:90000});
 const status=await page.locator('#status').innerText();
 assert.equal(await page.locator('#results').isVisible(),true,status);
 const samples=await page.locator('#segment-rows tr').count();
 await page.waitForTimeout(900);
 assert.ok(samples>=3&&samples<=50);
 assert.ok(await page.locator('.leaflet-overlay-pane svg').evaluate(e=>e.getBoundingClientRect().width)>300,'Route SVG is clipped by CSS');
 console.log(JSON.stringify({check:useFixtures?'desktop using captured live responses':'live desktop route and weather',status,samples,metrics:await page.locator('#metrics').innerText()}));
 await page.screenshot({path:'artifacts/desktop-results.png',fullPage:true});
 assert.ok(routeData?.routes?.length);assert.ok(Array.isArray(weatherData));
 await writeFile('artifacts/live-route.json',JSON.stringify(routeData));await writeFile('artifacts/live-weather.json',JSON.stringify(weatherData));
 await page.locator('[data-sample="1"]').click();assert.equal(await page.locator('.leaflet-popup').count(),1);
 await page.locator('#roads').fill('90');
 assert.equal(await page.locator('#results').isVisible(),false);
 console.log('Changing route parameters clears old forecast.');
 await context.close();

 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:'Asia/Jerusalem',serviceWorkers:'block'});
 await mobile.route('https://routing.openstreetmap.de/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(routeData)}));
 await mobile.route('https://api.open-meteo.com/v1/forecast**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(weatherData)}));
 const phone=await mobile.newPage();phone.on('pageerror',e=>failures.push(e.message));
 await phone.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 await phone.screenshot({path:'artifacts/mobile-initial.png',fullPage:true});
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page overflows horizontally');
 await phone.locator('#check-button').click();await phone.locator('#results').waitFor({state:'visible'});
 await phone.waitForTimeout(900);
 await phone.screenshot({path:'artifacts/mobile-results.png',fullPage:true});
 await phone.locator('#save-route').click();await phone.locator('#load-route').waitFor({state:'visible'});
 await phone.locator('#roads').fill('999999');await phone.locator('#check-button').click();
 await phone.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
 assert.match(await phone.locator('#status').innerText(),/אינן כוללות/);
 assert.equal(await phone.locator('#results').isVisible(),false);
 console.log('Missing requested road blocks forecast, saved route works, mobile layout fits.');
 await phone.locator('#roads').fill('');
 await mobile.unroute('https://api.open-meteo.com/v1/forecast**');
 const invalid=structuredClone(weatherData);invalid[0].hourly.wind_gusts_10m=invalid[0].hourly.wind_gusts_10m.map(()=>null);
 await mobile.route('https://api.open-meteo.com/v1/forecast**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(invalid)}));
 await phone.locator('#check-button').click();
 await phone.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
 assert.match(await phone.locator('#status').innerText(),/חסרים נתוני רוח/);
 assert.equal(await phone.locator('#results').isVisible(),false);
 console.log('Partial weather never appears as zero or a complete forecast.');
 await phone.locator('#add-stop').click();
 await phone.locator('[data-place^="stop-"] [data-pick]').click();
 await phone.locator('#map').click({position:{x:180,y:150}});
 assert.match(await phone.locator('[data-place^="stop-"] input').inputValue(),/מעבר במפה/);
 console.log('Map waypoint selection works on mobile.');
 await phone.locator('#install-button').click();assert.equal(await phone.locator('#install-dialog').isVisible(),true);
 await phone.locator('#install-dialog [data-close]').click();
 await mobile.setOffline(true);await phone.waitForTimeout(250);assert.equal(await phone.locator('#offline-banner').isVisible(),true);
 assert.deepEqual(failures,[]);console.log('Install guidance and offline state verified; no page errors.');
 await mobile.close();
}finally{await browser.close();}
