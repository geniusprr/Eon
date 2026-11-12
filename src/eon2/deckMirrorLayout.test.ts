import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DeckLayoutConflictError, DeckLayoutStore } from '../../electron/eon2/deck/DeckLayoutStore'
import {
  moveDeckTile, resizeDeckTile, clampDeckTile, deckPreset, defaultDeckLayout, patchDeckTile, validDeckWidgets, validateDeckLayout,
  DECK_PRESETS, DECK_COLUMNS, DECK_ROWS,
} from './deckMirrorLayout'

test('Electron and Android shared wire layout defaults match the authoritative PC store', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-deck-mirror-test-'))
  try {
    const server = new DeckLayoutStore(path.join(directory, 'layout.json'))
    const client = defaultDeckLayout()
    assert.deepEqual(server.get().widgets, client.widgets)
    assert.equal(validateDeckLayout(server.get())?.widgets.length, 7)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('all four editable Deck presets are 12×6 and accepted by the same server validator', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-deck-presets-'))
  try {
    const server = new DeckLayoutStore(path.join(directory, 'layout.json'))
    for (const item of DECK_PRESETS) {
      const widgets = deckPreset(item.id)
      assert.equal(validDeckWidgets(widgets), true, item.id)
      for (const widget of widgets.filter(tile => tile.visible)) {
        assert.ok(widget.x + widget.w <= DECK_COLUMNS && widget.y + widget.h <= DECK_ROWS, item.id)
      }
      const result = server.set({ baseRevision: server.get().revision, widgets })
      assert.deepEqual(result.widgets, widgets)
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('card edits reject overlaps and maintain stable IDs', () => {
  const old = deckPreset('minimal')
  const first = old.find(tile => tile.id === 'clock')!
  const shrunk = patchDeckTile(old, clampDeckTile(first, { w: 3 }))
  assert.ok(shrunk)
  assert.equal(shrunk?.find(tile => tile.id === 'clock')?.w, 3)
  const moved = patchDeckTile(shrunk!, clampDeckTile(shrunk!.find(tile => tile.id === 'clock')!, { x: 1 }))
  assert.ok(moved)
  assert.equal(moved?.find(tile => tile.id === 'clock')?.x, 1)
  assert.equal(patchDeckTile(old, { ...first, x: 5 }), null)
  assert.deepEqual(old, deckPreset('minimal'))
})

test('stale device revision never overwrites another device layout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-deck-cas-'))
  try {
    const server = new DeckLayoutStore(path.join(directory, 'layout.json'))
    const current = server.get()
    const result = server.set({ baseRevision: current.revision, widgets: deckPreset('media'), quickIds: [] })
    assert.equal(result.revision, current.revision + 1)
    assert.throws(() => server.set({ baseRevision: current.revision, widgets: deckPreset('minimal') }), DeckLayoutConflictError)
    assert.deepEqual(server.get().widgets, deckPreset('media'))
    assert.deepEqual(server.get().quickIds, [])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('dragging onto an occupied equal slot swaps widgets without overlap', () => {
  const tiles = deckPreset('balanced')
  const cpu = tiles.find(tile => tile.id === 'cpu')!
  const moved = moveDeckTile(tiles, { ...cpu, x: 6 })
  assert.ok(moved)
  assert.equal(moved.find(tile => tile.id === 'gpu')?.x, 4)
  assert.equal(moved.find(tile => tile.id === 'cpu')?.x, 6)
  assert.equal(validDeckWidgets(moved), true)
  assert.equal(moveDeckTile(tiles, { ...cpu, x: 7 }), null)
})

test('each resize edge keeps the opposite edge anchored and respects canvas and minimum size', () => {
  const tile = { id: 'clock' as const, x: 3, y: 2, w: 4, h: 3, visible: true }
  assert.deepEqual(resizeDeckTile(tile, 'nw', 1, 1), { ...tile, x: 4, y: 3, w: 3, h: 2 })
  assert.deepEqual(resizeDeckTile(tile, 'se', 1, 1), { ...tile, w: 5, h: 4 })
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
    for (const delta of [-100, 100]) {
      const result = resizeDeckTile(tile, edge, delta, delta)
      assert.ok(result.w >= 2 && result.h >= 2)
      assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.w <= 12 && result.y + result.h <= 6)
      if (!edge.includes('e')) assert.equal(result.x + result.w, tile.x + tile.w)
      if (!edge.includes('s')) assert.equal(result.y + result.h, tile.y + tile.h)
    }
  }
})


test('renderer accepts multiple named screens and rejects duplicate identities', () => {
  const base = defaultDeckLayout()
  const pages = [{ id: 'screen-1', name: 'Medya', widgets: deckPreset('media'), quickIds: [] }]
  const parsed = validateDeckLayout({ ...base, pages })
  assert.deepEqual(parsed?.pages, pages)
  pages[0].name = 'Changed'
  assert.equal(parsed?.pages?.[0].name, 'Medya')
  assert.equal(validateDeckLayout({ ...base, pages: [...pages, ...pages] }), null)
})


test('shortcut visibility round trips and rejects malformed preferences', () => {
  const layout = defaultDeckLayout()
  assert.equal(validateDeckLayout({ ...layout, hideShortcutNames: true })?.hideShortcutNames, true)
  assert.equal(validateDeckLayout({ ...layout, hideShortcutNames: false })?.hideShortcutNames, false)
  assert.equal(validateDeckLayout({ ...layout, hideShortcutNames: 'true' }), null)
  assert.equal(validateDeckLayout(layout)?.hideShortcutNames ?? false, false)
})
