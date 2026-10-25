import test from 'node:test';
import assert from 'node:assert/strict';
import { routeChoices, sameRoads, corridorProbes } from '../dist/routes.mjs';
import { rainLabel } from '../dist/weather-copy.mjs';

const points = [{ lon: 34.7, lat: 32 }, { lon: 34.8, lat: 32 }, { lon: 34.9, lat: 32 }];
const a = [[34.7, 32], [34.8, 32], [34.9, 32]];
const b = [[34.7, 32], [34.8, 32.04], [34.9, 32]];
const r = (line = a, duration = 600, ref = '1') => ({ distance: 20000, duration, geometry: { type: 'LineString', coordinates: line }, legs: [{ distance: 20000, steps: [{ ref, geometry: { coordinates: line } }] }] });
const ok = routes => ({ code: 'Ok', routes, waypoints: points.map(() => ({ distance: 5 })) });
const noWait = async () => {};

test('duplicate detection ignores vertex density and accepts genuinely different roads', () => {
  assert.equal(sameRoads(r(), r([[34.7, 32], [34.75, 32], [34.8, 32], [34.85, 32], [34.9, 32]])), true);
  assert.equal(sameRoads(r(), r(b)), false);
  assert.equal(sameRoads(r(b), r()), false);
});

test('two distinct standard alternatives need only one routing request', async () => {
  let calls = 0;
  const result = await routeChoices(points, { slot: noWait, request: async () => { calls++; return ok([r(), r(b, 700)]); } });
  assert.equal(calls, 1); assert.equal(result.routes.length, 2); assert.equal(result.extraSearch, 'not-needed');
});

test('a single route triggers an additional real routing request preserving ordered stops', async () => {
  const calls = [];
  const result = await routeChoices(points, { slot: noWait, request: async (url, timeout, attempts) => {
    calls.push({ url: new URL(url), timeout, attempts });
    return calls.length === 1 ? ok([r(), r(a, 601)]) : ok([r(b, 800, '38')]);
  } });
  assert.equal(result.routes.length, 2);
  assert.equal(calls[1].url.searchParams.get('continue_straight'), 'true');
  const coordinates = calls[1].url.pathname.split('/').at(-1).split(';');
  assert.deepEqual([coordinates[0], coordinates[2], coordinates[3]], ['34.700000,32.000000', '34.800000,32.000000', '34.900000,32.000000']);
  assert.equal(result.routes[1].via.after, 0);
  assert.equal(calls[1].attempts, 1); assert.equal(result.extraSearch, 'complete');
});

test('corridor probes are bounded and inserted in the longest leg, not before an unrelated stop', () => {
  const route = r();
  route.legs.unshift({ distance: 1000, steps: [{ geometry: { coordinates: [[34.69, 32], [34.7, 32]] } }] });
  const probes = corridorProbes(route);
  assert.equal(probes.length, 4); assert.ok(probes.every(p => p.after === 1));
  assert.ok(probes.every(p => p.lat >= 29 && p.lat <= 34 && p.lon >= 34 && p.lon <= 36.2));
});

test('a candidate requiring a U-turn is not offered as an alternative', async () => {
  const bad = r(b, 800); bad.legs[0].steps[0].maneuver = { modifier: 'uturn' };
  let calls = 0;
  const result = await routeChoices(points, { slot: noWait, request: async () => ++calls === 1 ? ok([r()]) : ok([bad]) });
  assert.equal(result.routes.length, 1);
});

test('optional routing failure, duplicates and excessive detours do not replace a valid route', async () => {
  for (const fallback of [new Error('offline'), ok([r()]), ok([r(b, 10000)])]) {
    let calls = 0;
    const result = await routeChoices(points, { slot: noWait, request: async () => {
      if (++calls === 1) return ok([r()]);
      if (fallback instanceof Error) throw fallback;
      return fallback;
    } });
    assert.equal(result.routes.length, 1); assert.equal(result.routes[0].duration, 600);
    assert.equal(result.extraSearch, fallback instanceof Error ? 'unavailable' : 'complete');
  }
});

test('selected roads affect whether more alternatives are sought without changing the request endpoints', async () => {
  let calls = 0;
  const result = await routeChoices(points, { requested: ['38'], slot: noWait, request: async () => {
    return ++calls === 1 ? ok([r(a, 600, '1'), r(b, 700, '38')]) : ok([r([[34.7, 32], [34.8, 31.96], [34.9, 32]], 750, '38')]);
  } });
  assert.equal(calls, 2);
  assert.equal(result.routes.filter(route => route.legs[0].steps[0].ref === '38').length, 2);
});

test('superseded searches and distant snapped endpoints cannot produce a selectable route', async () => {
  let current = true, calls = 0;
  await assert.rejects(() => routeChoices(points, { slot: noWait, isCurrent: () => current, request: async () => { calls++; current = false; return ok([r()]); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(() => routeChoices(points, { slot: noWait, request: async () => ({ ...ok([r()]), waypoints: [{ distance: 2000 }] }) }), /רחוקה מכביש/);
});

test('plain rain summaries distinguish missing data, no rain, chance, and expected precipitation', () => {
  assert.equal(rainLabel(null, 0), 'נתוני גשם חסרים');
  assert.equal(rainLabel(0, null), 'גשם: הסיכוי לא זמין');
  assert.equal(rainLabel(0, 0), 'לא צפוי גשם');
  assert.equal(rainLabel(0, 30), 'סיכוי לגשם 30%');
  assert.equal(rainLabel(.2, 30), 'צפוי גשם');
});
