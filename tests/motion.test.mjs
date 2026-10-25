import test from 'node:test';
import assert from 'node:assert/strict';
import { DampedValue } from '../dist/motion.mjs';
import { Ride3D } from '../dist/ride3d.mjs';

test('motion approaches its destination smoothly at different frame rates', () => {
  const values = [30, 60, 120].map(fps => {
    const motion = new DampedValue(0, .000001);
    motion.to(1000);
    let previous = 0;
    for (let frame = 0; frame < fps / 2; frame++) {
      const value = motion.step(1 / fps);
      assert.ok(value > previous && value < 1000);
      previous = value;
    }
    return motion.value;
  });
  for (const value of values) assert.ok(Math.abs(value - values[0]) < 1e-8);
});

test('reversing a drag preserves position and velocity and then settles', () => {
  const motion = new DampedValue(0);
  motion.to(1000); motion.step(.12);
  const { value, velocity } = motion;
  motion.to(0);
  assert.equal(motion.value, value);
  assert.equal(motion.velocity, velocity);
  const following = motion.step(.001);
  assert.ok(Math.abs(following - value) < velocity * .0011, 'retargeting must not teleport');
  for (let i = 0; i < 240; i++) motion.step(1 / 60);
  assert.ok(motion.settled);
  assert.equal(motion.value, 0);
});

test('heading changes across north use the short arc in both directions', () => {
  for (const [from, to, target] of [[359, 1, 361], [1, 359, -1]]) {
    const motion = new DampedValue(from);
    motion.angleTo(to);
    assert.equal(motion.target, target);
    for (let i = 0; i < 120; i++) motion.step(1 / 60);
    assert.equal(motion.value, target);
  }
});

function rider() {
  const ride = Object.create(Ride3D.prototype), views = [];
  const map = { stop() {}, isEasing: () => false, triggerRepaint() {}, getBearing: () => 0, jumpTo: view => views.push(view) };
  Object.assign(ride, {
    map, running: true, reduced: false, overview: false, heading: 90, distance: 0, pos: [35, 32],
    path: [[35, 32], [35.01, 32], [35.01, 32.01]], cum: [0, 1000, 2000],
    option: { samples: [{ distance: 0, heading: 90 }, { distance: 1000, heading: 45 }, { distance: 2000, heading: 0 }] }
  });
  return { ride, views };
}

test('scrubbing moves the bike and camera together along the road, preserving zoom', () => {
  const { ride, views } = rider();
  ride.select(2, 'ease');
  assert.deepEqual(ride.pos, [35, 32]);
  assert.equal(views.length, 0, 'selection itself must not jump the camera');
  for (let i = 0; i < 180; i++) {
    ride.advanceSelection(1 / 60);
    assert.ok(ride.pos[1] === 32 || ride.pos[0] === 35.01, 'must follow the corner, not cut across it');
    assert.deepEqual(views.at(-1).center, ride.pos);
    assert.equal(views.at(-1).zoom, undefined, 'keep the rider’s chosen zoom');
    assert.equal(views.at(-1).pitch, undefined);
  }
  assert.deepEqual(ride.pos, [35.01, 32.01]);
  assert.equal(ride.transition, null);
});

test('rapid scrubbing and chart refreshes keep the in-flight transition continuous', () => {
  const { ride } = rider();
  ride.select(2, 'ease'); ride.advanceSelection(.1);
  const motion = ride.transition, pos = ride.pos, velocity = motion.distance.velocity;
  ride.select(0, 'ease');
  assert.equal(ride.transition, motion);
  assert.equal(motion.distance.velocity, velocity);
  assert.deepEqual(ride.pos, pos);
  ride.select(0, null); // chart ResizeObserver refresh
  assert.equal(ride.transition, motion);
  assert.deepEqual(ride.pos, pos);
  for (let i = 0; i < 180; i++) ride.advanceSelection(1 / 60);
  assert.deepEqual(ride.pos, [35, 32]);
});

test('overview keeps its camera angle while the bike moves; pause stops pending motion', () => {
  const { ride, views } = rider();
  ride.overview = true;
  ride.select(2, 'ease'); ride.advanceSelection(.1);
  assert.equal(views.at(-1).bearing, undefined);
  ride.pause();
  const pos = ride.pos;
  ride.advanceSelection(.1);
  assert.deepEqual(ride.pos, pos);
  assert.equal(ride.transition, null);
});

test('initial selection and reduced-motion preferences use immediate positioning', () => {
  const { ride } = rider();
  ride.select(2, 'ease'); ride.advanceSelection(.1);
  ride.select(1, 'snap');
  assert.deepEqual(ride.pos, [35.01, 32]);
  assert.equal(ride.transition, null);
  ride.reduced = true;
  ride.select(2, 'ease');
  assert.deepEqual(ride.pos, [35.01, 32.01]);
  assert.equal(ride.transition, null);
});

test('moving the selection and loading terrain do not cancel an overview or zoom animation', () => {
  const { ride, views } = rider();
  ride.select(2, 'ease');
  ride.map.isEasing = () => true;
  ride.advanceSelection(.1);
  ride.recenter();
  assert.ok(ride.distance > 0, 'the bike continues moving during the camera transition');
  assert.equal(views.length, 0, 'jumpTo would stop the active camera animation');
  ride.map.isEasing = () => false;
  ride.advanceSelection(.1);
  assert.deepEqual(views.at(-1).center, ride.pos);
});
