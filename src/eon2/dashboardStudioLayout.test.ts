import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addStudioKind, createStudioState, hasCollision, layoutForPreset, placeTile,
  readStudioState, removeStudioKind, studioColumns, studioPresets, tileMin,
} from './dashboardStudioLayout'

test('every preset preserves all tiles without collision at each responsive width', () => {
  for (const preset of studioPresets) for (const columns of studioColumns) {
    const tiles = layoutForPreset(preset.id, columns)
    assert.ok(tiles.some(tile => tile.id === 'phone'), `${preset.id}/${columns} is missing the phone`)
    if (preset.id !== 'system') assert.equal(tiles.find(tile => tile.id === 'phone')?.y, 0, `${preset.id}/${columns} phone must remain at the top`)
    assert.equal(new Set(tiles.map(tile => tile.id)).size, tiles.length, `${preset.id}/${columns} duplicate widgets`)
    assert.equal(hasCollision(tiles), false, `${preset.id}/${columns} widgets intersect`)
    for (const tile of tiles) {
      const min = tileMin(tile.id, columns)
      assert.ok(tile.x >= 0 && tile.y >= 0 && tile.x + tile.w <= columns)
      assert.ok(tile.w >= min.w && tile.h >= min.h)
    }
  }
})

test('moving or resizing a widget moves conflicting widgets without losing their data', () => {
  const initial = createStudioState().layouts[12]
  const phone = initial.find(item => item.id === 'phone')!
  const moved = placeTile(initial, { ...phone, x: 7, y: 0, w: 5, h: 9 }, 12)
  assert.equal(hasCollision(moved), false)
  assert.deepEqual(moved.map(tile => tile.id).sort(), initial.map(tile => tile.id).sort())
  assert.deepEqual(moved.find(tile => tile.id === 'phone'), { ...phone, x: 7, y: 0, w: 5, h: 9 })
  assert.ok(moved.some(tile => tile.id !== 'phone' && tile.y !== initial.find(old => old.id === tile.id)?.y))
})

test('new and removed widgets stay consistent across every breakpoint', () => {
  const minimal = createStudioState('minimal')
  const expanded = addStudioKind(minimal, 'gpu')
  for (const columns of studioColumns) {
    assert.ok(expanded.layouts[columns].find(tile => tile.id === 'gpu'))
    assert.equal(hasCollision(expanded.layouts[columns]), false)
  }
  const removed = removeStudioKind(expanded, 'gpu')
  for (const columns of studioColumns) assert.equal(removed.layouts[columns].some(tile => tile.id === 'gpu'), false)
  assert.deepEqual(readStudioState(JSON.parse(JSON.stringify(removed))), removed)
})

test('malformed or conflicting saved geometry safely falls back to a usable default', () => {
  assert.deepEqual(readStudioState({ version: 1 }), createStudioState())
  const broken = createStudioState()
  broken.layouts[12][1] = { ...broken.layouts[12][0] }
  assert.deepEqual(readStudioState(broken), createStudioState())
  const excessive = createStudioState()
  excessive.layouts[8][0].y = 10_000_000
  assert.deepEqual(readStudioState(excessive), createStudioState())
})

test('saved presets refresh their responsive geometry while custom placements persist', () => {
  const oldPreset = createStudioState('balanced')
  const displaced = oldPreset.layouts[8].map(tile => tile.id === 'phone' ? { ...tile, y: 34 } : tile)
  oldPreset.layouts[8] = displaced
  assert.equal(hasCollision(displaced), false)
  assert.deepEqual(readStudioState(oldPreset), createStudioState('balanced'))

  const custom = createStudioState('balanced')
  custom.preset = 'custom'
  const changed = { ...custom, layouts: { ...custom.layouts, 8: displaced } }
  assert.deepEqual(readStudioState(changed), changed)
})
