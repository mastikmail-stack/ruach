import test from 'node:test';
import assert from 'node:assert/strict';
import { groundElevation } from '../dist/ride3d.mjs';

test('MapLibre 4 terrain offsets yield stable absolute camera height across hills, sea level and the Dead Sea', () => {
  let target = 0, ground = 800;
  const map = { getCameraTargetElevation: () => target, queryTerrainElevation: () => ground - target };
  for (ground of [800, 600, 20, 0, -420, 800]) {
    for (let frame = 0; frame < 4; frame++) {
      target = groundElevation(map, [35, 32]);
      assert.equal(target, ground, 'camera must not oscillate between ground and its offset');
    }
  }
  assert.equal(groundElevation({ getCameraTargetElevation: () => 0, queryTerrainElevation: () => null }, [35, 32]), 0);
});
