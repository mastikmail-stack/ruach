import test from 'node:test';
import assert from 'node:assert/strict';
import {bearing,windComponents,weatherAt,sampleRoute,chooseRoute,parseRoads,departureEpoch,localParts,validateDeparture} from '../dist/core.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test('head, tail, right and left wind projections',()=>{
 near(windComponents(30,0,0).head,30);near(windComponents(30,0,0).cross,0);
 near(windComponents(30,180,0).head,-30);near(windComponents(30,90,0).cross,30);
 assert.ok(windComponents(30,90,0).signedCross>0);assert.ok(windComponents(30,270,0).signedCross<0);
 near(windComponents(40,45,0).cross,40/Math.sqrt(2));
 near(bearing([35,32],[35,33]),0);near(bearing([35,32],[36,32]),89.735);
});
const hours={time:[1000,4600],wind_speed_10m:[20,20],wind_direction_10m:[350,10],wind_gusts_10m:[30,50]};
test('weather interpolation handles north crossing and preserves maximum gust',()=>{
 const w=weatherAt(hours,2800*1000,90);near(w.direction,0);near(w.gust,50);assert.ok(w.cross>19);assert.ok(w.crossGust>49);
});
test('missing and out-of-range weather are rejected, never replaced by zero',()=>{
 assert.throws(()=>weatherAt(hours,999*1000,0));assert.throws(()=>weatherAt(hours,4601*1000,0));
 assert.throws(()=>weatherAt({...hours,wind_speed_10m:[null,20]},2800*1000,0));
 assert.throws(()=>weatherAt({...hours,wind_gusts_10m:[30,null]},2800*1000,0));
 assert.throws(()=>weatherAt({...hours,wind_direction_10m:[]},2800*1000,0));
});
test('arrival times and sampling follow road geometry across multiple steps',()=>{
 const route={legs:[{steps:[{distance:10000,duration:600,ref:'1',geometry:{coordinates:[[35,32],[35,32.1]]}},{distance:10000,duration:1200,ref:'38',geometry:{coordinates:[[35,32.1],[35.1,32.1]]}}]}]};
 const ss=sampleRoute(route);assert.equal(ss.length,5);near(ss[0].seconds,0);near(ss.at(-1).seconds,1800);near(ss[2].seconds,600);near(ss.at(-1).distance,20000);assert.equal(ss.at(-1).road,'כביש 38');
});
test('route sampling is capped and retains both endpoints',()=>{
 const ss=sampleRoute({legs:[{steps:[{distance:800000,duration:10000,name:'דרך',geometry:{coordinates:[[34.8,30],[35,33]]}}]}]});
 assert.equal(ss.length,50);near(ss[0].lat,30);near(ss.at(-1).lat,33);
 assert.throws(()=>sampleRoute({legs:[{steps:[]}]}));
});
test('requested roads are verified against route refs, including missing roads',()=>{
 const r=(refs,duration)=>({duration,legs:[{steps:refs.map(ref=>({ref}))}]});
 const fast=r(['1','20'],10),slow=r(['38; 395','1'],20);
 assert.equal(chooseRoute([fast,slow],['38','395']).route,slow);
 assert.deepEqual(chooseRoute([fast,slow],['90']).missing,['90']);
 assert.deepEqual(chooseRoute([fast],['2']).missing,['2']);
 assert.deepEqual(parseRoads('1, 38, 1'),['1','38']);assert.throws(()=>parseRoads('דרך 1'));
});
test('Israel departure time uses Jerusalem zone independent of host timezone',()=>{
 const t=departureEpoch('2026-10-17','10:30');assert.equal(new Date(t).toISOString(),'2026-10-17T07:30:00.000Z');
 assert.deepEqual(localParts(t),{date:'2026-10-17',time:'10:30'});
 assert.equal(new Date(departureEpoch('2026-11-01','10:30')).toISOString(),'2026-11-01T08:30:00.000Z');
 assert.throws(()=>departureEpoch('2026-10-25','01:30'));
 assert.throws(()=>departureEpoch('2026-03-27','02:30'));
 assert.throws(()=>validateDeparture(t-120000,t));
 assert.throws(()=>validateDeparture(t+8*86400000,t));
});
