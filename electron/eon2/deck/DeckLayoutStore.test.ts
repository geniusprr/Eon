import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DeckLayoutConflictError, DeckLayoutStore, DeckLayoutValidationError } from './DeckLayoutStore.js'
import type { DeckLayoutWidget } from '../../../shared/contracts.js'

function fixture(run: (file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-deck-layout-'))
  try { run(path.join(dir, 'nested', 'deck-layout.json')) }
  finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('default 12×6 seven-widget Deck geometry, isolated snapshots, persisted atomic revision', () => fixture(file => {
  let store = new DeckLayoutStore(file)
  const initial = store.get()
  assert.equal(initial.version, 1)
  assert.equal(initial.revision, 0)
  assert.deepEqual(initial.widgets.map(({ id, x, y, w, h }) => [id, x, y, w, h]), [
    ['clock', 0, 0, 4, 2], ['cpu', 4, 0, 2, 3], ['gpu', 6, 0, 2, 3],
    ['ram', 8, 0, 2, 3], ['disk', 10, 0, 2, 3], ['media', 0, 2, 4, 4],
    ['shortcuts', 4, 3, 8, 3],
  ])
  initial.widgets[0].w = 11
  assert.equal(store.get().widgets[0].w, 4)

  const changed = store.get().widgets.map(widget => ({ ...widget }))
  changed[0] = { ...changed[0], visible: false }
  const next = store.set({ baseRevision: 0, widgets: changed })
  assert.equal(next.revision, 1)
  assert.equal(next.widgets[0].visible, false)
  next.widgets[0].visible = true
  assert.equal(store.get().widgets[0].visible, false)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['deck-layout.json'])

  store = new DeckLayoutStore(file)
  assert.equal(store.get().revision, 1)
  assert.equal(store.get().widgets[0].visible, false)
  assert.equal(store.get().updatedAt, next.updatedAt)
}))

test('stale desktop/mobile revisions do not overwrite the current layout', () => fixture(file => {
  const store = new DeckLayoutStore(file)
  const old = store.get()
  const changed = old.widgets.map(widget => ({ ...widget, visible: widget.id !== 'cpu' }))
  store.set({ baseRevision: 0, widgets: changed })
  assert.throws(() => store.set({ baseRevision: 0, widgets: old.widgets }), error => {
    assert.ok(error instanceof DeckLayoutConflictError)
    assert.equal(error.layout.revision, 1)
    assert.equal(error.layout.widgets.find(widget => widget.id === 'cpu')?.visible, false)
    return true
  })
  assert.equal(new DeckLayoutStore(file).get().revision, 1)
}))

test('reject missing, duplicate and foreign IDs, overlaps, invalid dimensions, out-of-bounds and bad input', () => fixture(file => {
  const store = new DeckLayoutStore(file)
  const original = store.get().widgets
  const mutate = (transform: (widgets: DeckLayoutWidget[]) => void) => {
    const widgets = original.map(widget => ({ ...widget }))
    transform(widgets)
    assert.throws(() => store.set({ baseRevision: 0, widgets }), DeckLayoutValidationError)
  }
  mutate(widgets => { widgets.pop() })
  mutate(widgets => { widgets[1].id = 'clock' })
  mutate(widgets => { widgets[1].id = 'foreign' as DeckLayoutWidget['id'] })
  mutate(widgets => { widgets[0].x = 4 })
  mutate(widgets => { widgets[0].w = 1 })
  mutate(widgets => { widgets[1].h = 1 })
  mutate(widgets => { widgets[6].x = 8 })
  mutate(widgets => { widgets[6].x = -1 })
  mutate(widgets => { widgets[6].w = 2 })
  mutate(widgets => { widgets[0].visible = 'true' as unknown as boolean })
  mutate(widgets => { widgets[1].x = 1.5 })
  assert.throws(() => store.set({ baseRevision: -1, widgets: original }), DeckLayoutValidationError)
  assert.throws(() => store.set({ baseRevision: '0', widgets: original }), DeckLayoutValidationError)
  assert.throws(() => store.set({ baseRevision: 0, widgets: original, unknown: true }), DeckLayoutValidationError)
  assert.throws(() => store.set({ baseRevision: 0, widgets: original.map((widget, i) =>
    i === 0 ? { ...widget, extra: 'bad' } : widget) }), DeckLayoutValidationError)
  assert.throws(() => store.set({ baseRevision: 0, widgets: original, extra: 'x'.repeat(5000) }), DeckLayoutValidationError)
  assert.equal(store.get().revision, 0)
  assert.equal(fs.existsSync(file), false)
}))

test('hidden widgets do not block other widgets from occupying their previous cells', () => fixture(file => {
  const store = new DeckLayoutStore(file)
  const widgets = store.get().widgets.map(widget => ({ ...widget }))
  widgets.find(widget => widget.id === 'clock')!.visible = false
  widgets.find(widget => widget.id === 'media')!.y = 0
  const result = store.set({ baseRevision: 0, widgets })
  assert.equal(result.widgets.find(widget => widget.id === 'media')!.y, 0)
  assert.equal(result.widgets.find(widget => widget.id === 'clock')!.visible, false)
}))

test('optional quickIds persist ordered shortcut selection while legacy writes preserve it', () => fixture(file => {
  let store = new DeckLayoutStore(file)
  const widgets = store.get().widgets
  assert.equal(store.get().quickIds, undefined)
  assert.deepEqual(store.set({ baseRevision: 0, widgets, quickIds: ['tool:explorer', 'action:lock'] }).quickIds,
    ['tool:explorer', 'action:lock'])
  store = new DeckLayoutStore(file)
  assert.deepEqual(store.get().quickIds, ['tool:explorer', 'action:lock'])
  assert.deepEqual(store.set({ baseRevision: 1, widgets }).quickIds, ['tool:explorer', 'action:lock'])
  assert.deepEqual(store.set({ baseRevision: 2, widgets, quickIds: [] }).quickIds, [])
  assert.equal(store.set({ baseRevision: 3, widgets, quickIds: null }).quickIds, null)
  for (const quickIds of [['action:lock', 'action:lock'], ['tool:invalid'], ['action:bad id'],
    Array.from({ length: 7 }, (_, i) => `action:id-${i}`)]) {
    assert.throws(() => store.set({ baseRevision: 4, widgets, quickIds }), DeckLayoutValidationError)
  }
  assert.equal(store.get().revision, 4)
}))


test('named screens persist independently, survive legacy writes, and have no fixed page count', () => fixture(file => {
  let store = new DeckLayoutStore(file)
  const base = store.get()
  const pages = Array.from({ length: 300 }, (_, index) => ({ id: `screen-${index}`, name: `Ekran ${index}`, widgets: base.widgets.map(widget => ({ ...widget })), quickIds: ['tool:explorer'] }))
  const next = store.set({ baseRevision: 0, widgets: base.widgets, pages })
  assert.equal(next.pages?.length, 300)
  next.pages![0].widgets[0].visible = false
  assert.equal(store.get().pages![0].widgets[0].visible, true)
  store.set({ baseRevision: 1, widgets: base.widgets, quickIds: [] })
  store = new DeckLayoutStore(file)
  assert.deepEqual(store.get().pages, pages)
  assert.throws(() => store.set({ baseRevision: 1, widgets: base.widgets, pages: [] }), DeckLayoutConflictError)
  assert.equal(store.get().pages?.length, 300)
  const invalid = [
    [pages[0], pages[0]], [{ ...pages[0], id: 'panel' }], [{ ...pages[0], name: ' ' }],
    [{ ...pages[0], widgets: [] }], [{ ...pages[0], quickIds: ['tool:arbitrary'] }],
  ]
  for (const items of invalid) assert.throws(() => store.set({ baseRevision: 2, widgets: base.widgets, pages: items }), DeckLayoutValidationError)
  store.set({ baseRevision: 2, widgets: base.widgets, pages: [] })
  assert.deepEqual(new DeckLayoutStore(file).get().pages, [])
}))


test('shortcut label visibility persists, survives legacy writes and validates input', () => fixture(file => {
  let store = new DeckLayoutStore(file)
  assert.equal(store.get().hideShortcutNames ?? false, false)
  const hidden = store.set({ baseRevision: 0, widgets: store.get().widgets, hideShortcutNames: true })
  assert.equal(hidden.hideShortcutNames, true)
  store = new DeckLayoutStore(file)
  assert.equal(store.get().hideShortcutNames, true)
  const preserved = store.set({ baseRevision: 1, widgets: store.get().widgets, pages: [] })
  assert.equal(preserved.hideShortcutNames, true)
  for (const invalid of [null, 'true', 1, {}]) {
    assert.throws(() => store.set({ baseRevision: 2, widgets: store.get().widgets, hideShortcutNames: invalid }), DeckLayoutValidationError)
  }
  assert.equal(store.set({ baseRevision: 2, widgets: store.get().widgets, hideShortcutNames: false }).hideShortcutNames, false)
}))

test('the shortcut screen persists its own order and empty state without changing widget favourites', () => fixture(file => {
  const store = new DeckLayoutStore(file)
  const { widgets } = store.get()
  const quickIds = ['tool:explorer']
  const shortcutIds = ['tool:terminal', ...Array.from({ length: 16 }, (_, index) => `action:test-${index}`)]
  const saved = store.set({ baseRevision: 0, widgets, quickIds, shortcutIds })
  saved.shortcutIds?.reverse()
  const restored = new DeckLayoutStore(file)
  assert.deepEqual(restored.get().shortcutIds, shortcutIds)
  assert.deepEqual(restored.set({ baseRevision: 1, widgets }).shortcutIds, shortcutIds)
  assert.throws(() => restored.set({ baseRevision: 2, widgets, shortcutIds: ['tool:terminal', 'tool:terminal'] }), DeckLayoutValidationError)
  assert.deepEqual(restored.set({ baseRevision: 2, widgets, shortcutIds: [] }).shortcutIds, [])
  assert.deepEqual(restored.set({ baseRevision: 3, widgets, shortcutIds: null }).shortcutIds, null)
  assert.deepEqual(restored.get().quickIds, quickIds)
}))
