import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsAt, conditionName, summarizeConditions, compareWind } from '../dist/conditions.mjs';
import { sampleRoute } from '../dist/core.mjs';

const hours = {
  time: [3600, 7200, 10800], precipitation: [9, 2, 4],
  precipitation_probability: [10, 50, 80], temperature_2m: [0, 10, 20], weather_code: [0, 61, 95]
};
test('rain uses the arrival hour accumulation, not interpolation or the earlier hour', () => {
  const w = conditionsAt(hours, 5400 * 1000);
  assert.equal(w.precipitation, 2);
  assert.equal(w.rainProbability, 50);
  assert.equal(w.temperature, 5);
  assert.equal(conditionsAt(hours, 7200 * 1000).precipitation, 2);
  assert.equal(conditionsAt(hours, 7201 * 1000).precipitation, 4);
  assert.equal(conditionsAt(hours, 3600 * 1000).temperature, 0);
});

test('missing, invalid and out-of-range conditions remain unavailable, zero rain stays valid', () => {
  const w = conditionsAt({ ...hours, precipitation: [0, null, 1], precipitation_probability: [0, 101, 0], temperature_2m: [0, null, 20] }, 5400 * 1000);
  assert.equal(w.precipitation, null); assert.equal(w.rainProbability, null); assert.equal(w.temperature, null);
  assert.equal(conditionsAt({ ...hours, precipitation: [0, 0, 0] }, 5400 * 1000).precipitation, 0);
  assert.equal(conditionsAt(hours, 11000 * 1000).precipitation, null);
  assert.equal(conditionsAt(null, 5400 * 1000).weatherCode, null);
  assert.equal(conditionName(null), 'מצב שמיים לא זמין');
  assert.equal(conditionName(95), 'סופות רעמים');
});

const point = (crossGust, precipitation, rainProbability) => ({ crossGust, precipitation, rainProbability, speed: 20, gust: 35 });
test('route summaries retain wind hotspots and never sum rain or hide missing rain points', () => {
  const samples = [point(20, 2, 40), point(30, 4, 70), point(5, 1, 10)];
  const s = summarizeConditions(samples);
  assert.equal(s.peak, 1); assert.equal(s.quiet, 2); assert.equal(s.maxCross, 30);
  assert.equal(s.maxRain, 4); assert.equal(s.maxRainProbability, 70);
  assert.equal(summarizeConditions([...samples, point(10, null, null)]).maxRain, null);
  assert.equal(summarizeConditions([...samples, point(10, null, null)]).maxRainProbability, null);
});

test('least side-wind comparison finds the real minimum regardless of order and retains ties', () => {
  assert.deepEqual(compareWind([20, 19, 18].map(maxCross => ({ maxCross }))), { spread: 2, least: [2] });
  assert.deepEqual(compareWind([18, 20, 19].map(maxCross => ({ maxCross }))), { spread: 2, least: [0] });
  assert.deepEqual(compareWind([18.1, 18.4, 23].map(maxCross => ({ maxCross }))), { spread: 5, least: [0, 1] });
});

test('urban sampling increases road-direction checks while preserving times and endpoints', () => {
  const route = { legs: [{ steps: [
    { distance: 1000, duration: 200, name: 'צפונה', geometry: { coordinates: [[34.8, 32], [34.8, 32.01]] } },
    { distance: 1000, duration: 400, name: 'מזרחה', geometry: { coordinates: [[34.8, 32.01], [34.81, 32.01]] } }
  ] }] };
  const urban = sampleRoute(route, { spacingMeters: 250 });
  assert.equal(sampleRoute(route).length, 3); assert.equal(urban.length, 9);
  assert.equal(urban[0].seconds, 0); assert.equal(urban.at(-1).seconds, 600);
  assert.equal(urban[0].lon, 34.8); assert.equal(urban.at(-1).lon, 34.81);
  assert.ok(urban.some(s => s.heading > 80)); assert.ok(urban.some(s => s.heading < 10));
  for (let i = 1; i < urban.length; i++) assert.equal(urban[i].distance - urban[i - 1].distance, 250);
  assert.equal(sampleRoute({ legs: [{ steps: [{ ...route.legs[0].steps[0], distance: 100000 }] }] }, { spacingMeters: 250 }).length, 50);
});
