import test from 'node:test';
import assert from 'node:assert/strict';
import {windRelation} from '../dist/view.mjs';
test('wind from the east meets a northbound rider from the right',()=>{
 assert.equal(windRelation(90,0,20).label,'הרוח מגיעה מימין');
 assert.equal(windRelation(90,0,20).relative,90);
});
test('rotating the rider changes the interpretation without changing the weather',()=>{
 assert.equal(windRelation(90,90,20).label,'הרוח מגיעה מלפנים');
 assert.equal(windRelation(90,180,20).label,'הרוח מגיעה משמאל');
 assert.equal(windRelation(90,270,20).label,'הרוח מגיעה מאחור');
});
test('diagonal directions and north wrap retain the correct sides',()=>{
 assert.equal(windRelation(45,0,20).label,'הרוח מגיעה מימין ומלפנים');
 assert.equal(windRelation(225,0,20).label,'הרוח מגיעה משמאל ומאחור');
 assert.equal(windRelation(0,350,20).relative,10);
});
test('almost calm wind does not display a confident directional arrow',()=>{
 assert.equal(windRelation(180,0,.5).visible,false);
 assert.equal(windRelation(180,0,5).visible,true);
});
