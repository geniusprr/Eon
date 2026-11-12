import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { defaultColumns, moveWidget, readColumns, widgetColumn, type BoardColumn, type Widget, type WidgetKind } from './workspace'

interface Props {
  widgets: Widget[]
  setWidgets: (update: Widget[] | ((previous: Widget[]) => Widget[])) => void
  catalog: Array<{ kind: WidgetKind; label: string; ready: boolean; icon: typeof Plus }>
  renderWidget: (widget: Widget, controls: ReactNode) => ReactNode
}

function BoardMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const node = menu.current
    if (!node) return
    node.popover = 'auto'
    const update = () => setOpen(node.matches(':popover-open'))
    node.addEventListener('toggle', update)
    return () => node.removeEventListener('toggle', update)
  }, [])
  return <div className="eon2-board-menu"><button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={event => {
    const node = menu.current
    if (!node) return
    if (node.matches(':popover-open')) { node.hidePopover(); return }
    const rect = event.currentTarget.getBoundingClientRect()
    node.showPopover()
    const bounds = node.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8))}px`
    node.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8))}px`
    node.querySelector<HTMLElement>('select, button:not(:disabled)')?.focus()
  }}><MoreHorizontal size={16}/></button><div ref={menu} id={id} className="eon2-board-popover" onClick={event => {
    if ((event.target as HTMLElement).closest('button')) menu.current?.hidePopover()
  }}>{children}</div></div>
}

function loadColumns() {
  try { return readColumns(JSON.parse(localStorage.getItem('eon2:board-columns') || 'null')) }
  catch { return defaultColumns.map(column => ({ ...column })) }
}

export function WorkspaceBoard({ widgets, setWidgets, catalog, renderWidget }: Props) {
  const [columns, setColumns] = useState<BoardColumn[]>(loadColumns)
  const [dragging, setDragging] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const picker = useRef<HTMLDialogElement>(null)
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => { localStorage.setItem('eon2:board-columns', JSON.stringify(columns)) }, [columns])
  useEffect(() => { if (addingTo) picker.current?.showModal() }, [addingTo])
  useEffect(() => {
    if (!pendingFocus.current) return
    document.querySelector<HTMLButtonElement>(`[data-widget-id="${CSS.escape(pendingFocus.current)}"] .eon2-card-grip`)?.focus()
    pendingFocus.current = null
  }, [widgets])
  const nameOf = (widget: Widget) => catalog.find(item => item.kind === widget.kind)?.label || 'Kart'
  const move = (widget: Widget, columnId: string, beforeId?: string) => {
    pendingFocus.current = widget.id
    setWidgets(current => moveWidget(current, widget.id, columnId, beforeId))
    setAnnouncement(`${nameOf(widget)}, ${columns.find(column => column.id === columnId)?.title} sütununa taşındı.`)
  }
  const drop = (event: DragEvent<HTMLElement>, columnId: string, beforeId?: string) => {
    event.preventDefault(); event.stopPropagation()
    const id = event.dataTransfer.getData('application/x-eon-widget')
    const widget = widgets.find(item => item.id === id)
    if (widget) move(widget, columnId, beforeId)
    setDragging(null); setOverColumn(null)
  }
  const rename = (column: BoardColumn) => {
    if (title.trim()) setColumns(current => current.map(item => item.id === column.id ? { ...item, title: title.trim() } : item))
    setRenaming(null)
  }
  const shiftColumn = (index: number, offset: number) => setColumns(current => {
    const next = [...current]
    const target = index + offset
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  return <div className="eon2-workspace">
    <div className="eon2-board-toolbar"><button type="button" className="eon2-button eon2-button--outline" disabled={widgets.length >= 60} onClick={() => setAddingTo(columns[0].id)}><Plus size={15}/> Kart ekle</button><button type="button" className="eon2-button eon2-button--quiet" disabled={columns.length >= 8} onClick={() => {
      const column = { id: crypto.randomUUID(), title: 'Yeni sütun' }
      setColumns(current => [...current, column]); setTitle(column.title); setRenaming(column.id)
    }}><Plus size={15}/> Sütun ekle</button></div>
    <div className="eon2-kanban" aria-label="Çalışma panosu">
      {columns.map((column, columnIndex) => {
        const cards = widgets.filter(widget => widgetColumn(widget, columns) === column.id)
        return <section className={`eon2-kanban-column ${overColumn === column.id ? 'is-drop-target' : ''}`} key={column.id} aria-label={column.title}
          onDragOver={event => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverColumn(column.id) } }}
          onDrop={event => drop(event, column.id)}>
          <header className="eon2-column-header">
            {renaming === column.id ? <input autoFocus className="eon2-column-name" aria-label="Sütun adı" value={title} maxLength={40} onChange={event => setTitle(event.target.value)} onBlur={() => rename(column)} onKeyDown={event => { if (event.key === 'Enter') rename(column); if (event.key === 'Escape') setRenaming(null) }}/>
              : <button type="button" className="eon2-column-title" title="Sütunu yeniden adlandır" onClick={() => { setTitle(column.title); setRenaming(column.id) }}><h2>{column.title}</h2><span>{cards.length}</span></button>}
            <BoardMenu label={`${column.title} sütun seçenekleri`}>
              <button type="button" disabled={!columnIndex} onClick={() => shiftColumn(columnIndex, -1)}><ArrowLeft size={14}/> Sola taşı</button>
              <button type="button" disabled={columnIndex === columns.length - 1} onClick={() => shiftColumn(columnIndex, 1)}><ArrowRight size={14}/> Sağa taşı</button>
              <button type="button" disabled={!!cards.length || columns.length === 1} title={cards.length ? 'Önce kartları başka sütuna taşı' : undefined} onClick={() => setColumns(current => current.filter(item => item.id !== column.id))}><Trash2 size={14}/> Sütunu sil</button>
            </BoardMenu>
          </header>
          <div className="eon2-column-cards">{cards.map((widget, index) => <div key={widget.id} data-widget-id={widget.id} className={`eon2-kanban-card ${dragging === widget.id ? 'is-dragging' : ''}`} onDragOver={event => { if (dragging) event.preventDefault() }} onDrop={event => drop(event, column.id, widget.id)}>
            {renderWidget(widget, <div className="eon2-card-controls">
              <button type="button" className="eon2-card-grip" draggable aria-label={`${nameOf(widget)} kartını sürükle`} title="Kartı sürükle" onDragStart={event => { event.dataTransfer.setData('application/x-eon-widget', widget.id); event.dataTransfer.effectAllowed = 'move'; setDragging(widget.id) }} onDragEnd={() => { setDragging(null); setOverColumn(null) }}><GripVertical size={16}/></button>
              <BoardMenu label={`${nameOf(widget)} kart seçenekleri`}>
                <label>Sütun<select aria-label={`${nameOf(widget)} kartını taşı`} value={column.id} onChange={event => move(widget, event.target.value)}>{columns.map(destination => <option key={destination.id} value={destination.id}>{destination.title}</option>)}</select></label>
                <button type="button" disabled={!index} onClick={() => move(widget, column.id, cards[index - 1].id)}><ArrowUp size={14}/> Yukarı taşı</button>
                <button type="button" disabled={index === cards.length - 1} onClick={() => move(widget, column.id, cards[index + 2]?.id)}><ArrowDown size={14}/> Aşağı taşı</button>
                <button type="button" onClick={() => { setWidgets(current => current.filter(item => item.id !== widget.id)); setAnnouncement(`${nameOf(widget)} kartı kaldırıldı.`) }}><Trash2 size={14}/> Kartı kaldır</button>
              </BoardMenu>
            </div>)}
          </div>)}</div>
          <button type="button" className="eon2-column-add" disabled={widgets.length >= 60} onClick={() => setAddingTo(column.id)}><Plus size={16}/> Kart ekle</button>
        </section>
      })}
    </div>
    <div className="eon2-visually-hidden" role="status" aria-live="polite">{announcement}</div>
    {addingTo && <dialog ref={picker} className="eon2-board-picker" aria-labelledby="board-picker-title" onCancel={() => setAddingTo(null)}><header><h2 id="board-picker-title">Kart ekle</h2><button type="button" className="eon2-button eon2-button--quiet" aria-label="Kapat" onClick={() => setAddingTo(null)}><X size={18}/></button></header><div className="eon2-card-catalog">{catalog.filter(item => item.ready).map(item => <button type="button" key={item.kind} onClick={() => {
      setWidgets(current => current.length >= 60 ? current : [...current, { id: crypto.randomUUID(), kind: item.kind, size: 1, columnId: addingTo }])
      setAnnouncement(`${item.label} kartı eklendi.`); setAddingTo(null)
    }}><item.icon size={22}/><span>{item.label}</span><Plus size={15}/></button>)}</div></dialog>}
  </div>
}
