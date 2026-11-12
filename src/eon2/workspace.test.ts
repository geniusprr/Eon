import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultColumns, moveWidget, readColumns, widgetColumn, type Widget } from './workspace'

test('legacy widgets retain their IDs and receive stable default columns', () => {
  const widgets: Widget[] = [
    { id: 'cpu', kind: 'cpu', size: 1 },
    { id: 'phone', kind: 'devices', size: 1 },
    { id: 'notes', kind: 'notes', size: 2 },
  ]
  assert.deepEqual(widgets.map(widget => widgetColumn(widget, defaultColumns)), ['system', 'connection', 'personal'])
  assert.equal(widgetColumn({ ...widgets[0], columnId: 'removed' }, defaultColumns), 'system')
  assert.equal(widgetColumn(widgets[2], [...defaultColumns].reverse()), 'personal')
})

test('moving within/between columns preserves every card once and its content', () => {
  const widgets: Widget[] = [
    { id: 'a', kind: 'cpu', size: 1, columnId: 'system' },
    { id: 'b', kind: 'memory', size: 1, columnId: 'system' },
    { id: 'c', kind: 'notes', size: 2, columnId: 'personal' },
  ]
  const reordered = moveWidget(widgets, 'b', 'system', 'a')
  assert.deepEqual(reordered.map(widget => widget.id), ['b', 'a', 'c'])
  const moved = moveWidget(reordered, 'b', 'personal', 'c')
  assert.deepEqual(moved.map(widget => widget.id), ['a', 'b', 'c'])
  assert.equal(moved.find(widget => widget.id === 'b')?.columnId, 'personal')
  assert.equal(new Set(moved.map(widget => widget.id)).size, 3)
  assert.equal(moved.find(widget => widget.id === 'c')?.size, 2)
  assert.equal(moveWidget(widgets, 'a', 'system', 'a'), widgets)
  assert.equal(moveWidget(widgets, 'missing', 'system'), widgets)
})

test('invalid saved columns recover safely; custom column order/names roundtrip', () => {
  for (const value of [null, [], [{ id: 'x', title: '' }], [{ id: 'x', title: 'One' }, { id: 'x', title: 'Two' }]]) {
    assert.deepEqual(readColumns(value), defaultColumns)
  }
  const columns = [{ id: 'custom', title: 'Yapılacaklar' }, { id: 'other', title: 'Bitti' }]
  assert.deepEqual(readColumns(JSON.parse(JSON.stringify(columns))), columns)
})
