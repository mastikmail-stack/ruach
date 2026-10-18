import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationLinks,forecastPlan} from '../dist/navigation.mjs';
const origin={lat:32.0853,lon:34.7818},end={lat:31.7683,lon:35.2137};
test('navigation transfers endpoints and ordered stops without keys',()=>{
 const stop={lat:31.8,lon:35};const links=navigationLinks([origin,stop,end]);const g=new URL(links.google),w=new URL(links.waze);
 assert.equal(g.searchParams.get('api'),'1');assert.equal(g.searchParams.get('origin'),'32.085300,34.781800');assert.equal(g.searchParams.get('destination'),'31.768300,35.213700');assert.equal(g.searchParams.get('waypoints'),'31.800000,35.000000');assert.equal(w.searchParams.get('ll'),'31.768300,35.213700');assert.equal(w.searchParams.get('vehicle_type'),'motorcycle');assert.equal(w.searchParams.has('origin'),false);assert.equal(g.searchParams.has('key'),false);
});
test('mobile waypoint limit never silently drops a requested stop',()=>{
 const links=navigationLinks([origin,...Array.from({length:4},(_,i)=>({lat:31.8+i*.01,lon:35})),end]);assert.equal(links.google,null);assert.equal(links.tooManyStops,true);assert.ok(links.waze);assert.equal(navigationLinks([origin]),null);
});
test('shared forecast locations retain route-specific arrival lookups',()=>{
 const shared={lat:32.123456,lon:35.123456};const p=forecastPlan([[origin,shared],[shared,end]]);
 assert.equal(p.locations.length,3);assert.deepEqual(p.lookups,[[0,1],[1,2]]);assert.deepEqual(p.locations[1],{lat:32.1235,lon:35.1235});
});
