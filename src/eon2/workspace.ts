export type WidgetKind = 'cpu' | 'memory' | 'uptime' | 'devices' | 'notes' | 'clock' | 'disk' | 'gpu' | 'network' | 'media' | 'shortcuts' | 'pomodoro'
export interface Widget { id: string; kind: WidgetKind; size: 1 | 2; columnId?: string }
export interface BoardColumn { id: string; title: string }

export const defaultColumns: BoardColumn[] = [
  { id: 'system', title: 'Sistem' },
  { id: 'connection', title: 'Cihazlar' },
  { id: 'personal', title: 'Kişisel' },
]

export function widgetColumn(widget: Widget, columns: BoardColumn[]): string {
  const preferred = widget.columnId || (widget.kind === 'devices' ? 'connection' : ['notes', 'clock'].includes(widget.kind) ? 'personal' : 'system')
  return columns.find(column => column.id === preferred)?.id || columns[0].id
}

/** Remove before inserting: same-column moves never duplicate or lose a card. */
export function moveWidget(widgets: Widget[], id: string, columnId: string, beforeId?: string): Widget[] {
  const widget = widgets.find(item => item.id === id)
  if (!widget || beforeId === id) return widgets
  const next = widgets.filter(item => item.id !== id)
  const index = beforeId ? next.findIndex(item => item.id === beforeId) : -1
  next.splice(index < 0 ? next.length : index, 0, { ...widget, columnId })
  return next
}

export function readColumns(value: unknown): BoardColumn[] {
  if (!Array.isArray(value) || !value.length || value.length > 8 || !value.every(column =>
    column && typeof column === 'object' && typeof column.id === 'string' && /^[a-zA-Z0-9-]{1,90}$/.test(column.id) &&
    typeof column.title === 'string' && column.title.trim().length > 0 && column.title.length <= 40) || new Set(value.map(column => column.id)).size !== value.length) return defaultColumns.map(column => ({ ...column }))
  return value.map(column => ({ id: column.id, title: column.title.trim() }))
}
