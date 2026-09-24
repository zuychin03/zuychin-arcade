import assert from 'node:assert/strict';
import test from 'node:test';
import { CARTOGRAPHERS_CARD_BY_ID, CARTOGRAPHERS_CARDS } from '@zuychin-arcade/types';
import { cellIndex, destructionTargets, emptyChart, placementFits, placementPreview, shapeOptions, terrainOptions, transformShape } from './geometry';

test('all eight transformations retain shape cells and anchor their bounding box', () => {
  for (const card of CARTOGRAPHERS_CARDS) for (const shape of shapeOptions(card, false)) for (const rotation of [0, 90, 180, 270] as const) for (const mirrored of [false, true]) {
    const result = transformShape(shape, { anchor: { x: 2, y: 3 }, rotation, mirrored });
    assert.equal(new Set(result.map(cellIndex)).size, shape.length);
    assert.equal(Math.min(...result.map(p => p.x)), 2); assert.equal(Math.min(...result.map(p => p.y)), 3);
  }
});
test('preview rejects borders, mountains, wasteland and destroyed cells, not shape gaps', () => {
  const map = emptyChart('D'); assert.equal(placementFits(map, [{ x: 11, y: 0 }]), false);
  assert.equal(placementFits(map, [{ x: 1, y: 1 }]), false); assert.equal(placementFits(map, [{ x: 9, y: 1 }]), false);
  map.cells[0]!.destroyed = true; assert.equal(placementFits(map, [{ x: 0, y: 0 }]), false);
  assert.equal(placementFits(map, [{ x: 0, y: 1 }, { x: 2, y: 1 }]), true);
});
test('Gorgon candidates are computed after hero protection and never include mountains', () => {
  const map = emptyChart('C'); map.attackCells = [0, 2, 12];
  const assignment = { targetPlayerId: 'p', displayName: 'P', submissionToken: '1', map, fallback: false, fixedPlacement: null };
  const preview = placementPreview(assignment, CARTOGRAPHERS_CARD_BY_ID.gorgon!, 0, 'monster', { anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false });
  assert.equal(preview.valid, false, 'centre overlaps printed mountain');
  const clear = emptyChart('C'); clear.cells[12]!.terrain = null; clear.attackCells = [0, 2, 12];
  const safe = placementPreview({ ...assignment, map: clear }, CARTOGRAPHERS_CARD_BY_ID.gorgon!, 0, 'monster', { anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false });
  assert.equal(safe.valid, true); assert.deepEqual(safe.targets, []); assert.equal(clear.cells[0]!.terrain, null);
});
test('hero attacks rotate about hero rather than normalised attack bounding box', () => {
  const p = transformShape([{ x: 1, y: 0 }, { x: 2, y: 0 }], { anchor: { x: 5, y: 5 }, rotation: 90, mirrored: false }, false);
  assert.deepEqual(p, [{ x: 5, y: 6 }, { x: 5, y: 7 }]);
});
test('Troll destroys only empty neighbours; fallback has no named monster effect', () => {
  const map = emptyChart('C'); map.cells[0] = { terrain: 'monster', monster: 'troll', destroyed: false, wasteland: false }; map.cells[1]!.destroyed = true;
  assert.deepEqual(destructionTargets(map, 'troll'), [11]);
  assert.deepEqual(terrainOptions(CARTOGRAPHERS_CARD_BY_ID.gorgon!, true), ['monster']);
  assert.equal(shapeOptions(CARTOGRAPHERS_CARD_BY_ID.gorgon!, true)[0]!.length, 1);
  assert.ok(terrainOptions(CARTOGRAPHERS_CARD_BY_ID.lagoon!, true).includes('hero'));
});
