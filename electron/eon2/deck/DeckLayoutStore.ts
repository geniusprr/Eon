import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeckPage, DeckLayout, DeckLayoutSetInput, DeckLayoutWidget, DeckWidgetId } from '../../../shared/contracts.js'

const COLUMNS = 12
const ROWS = 6
export const MAX_DECK_LAYOUT_BYTES = 8 * 1024 * 1024

const IDS: readonly DeckWidgetId[] = ['clock', 'cpu', 'gpu', 'ram', 'disk', 'media', 'shortcuts']
const MINIMUM: Record<DeckWidgetId, readonly [number, number]> = {
  clock: [2, 2], cpu: [1, 2], gpu: [1, 2], ram: [1, 2], disk: [1, 2],
  media: [3, 2], shortcuts: [3, 2],
}

const INITIAL_WIDGETS: readonly DeckLayoutWidget[] = [
  { id: 'clock', x: 0, y: 0, w: 4, h: 2, visible: true },
  { id: 'cpu', x: 4, y: 0, w: 2, h: 3, visible: true },
  { id: 'gpu', x: 6, y: 0, w: 2, h: 3, visible: true },
  { id: 'ram', x: 8, y: 0, w: 2, h: 3, visible: true },
  { id: 'disk', x: 10, y: 0, w: 2, h: 3, visible: true },
  { id: 'media', x: 0, y: 2, w: 4, h: 4, visible: true },
  { id: 'shortcuts', x: 4, y: 3, w: 8, h: 3, visible: true },
]

export class DeckLayoutValidationError extends Error {
  constructor(message = 'invalid-deck-layout') { super(message); this.name = 'DeckLayoutValidationError' }
}

export class DeckLayoutConflictError extends Error {
  readonly layout: DeckLayout
  constructor(layout: DeckLayout) {
    super('deck-layout-conflict')
    this.name = 'DeckLayoutConflictError'
    this.layout = layout
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DeckLayoutValidationError()
  return value as Record<string, unknown>
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !hasOwn(value, key))) {
    throw new DeckLayoutValidationError()
  }
}

function onlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  if (required.some(key => !hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new DeckLayoutValidationError()
  }
}

function safeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function parseWidgets(value: unknown): DeckLayoutWidget[] {
  if (!Array.isArray(value) || value.length !== IDS.length) throw new DeckLayoutValidationError()
  const seen = new Set<DeckWidgetId>()
  const occupied = new Set<number>()
  return value.map(raw => {
    const item = record(raw)
    exactKeys(item, ['id', 'x', 'y', 'w', 'h', 'visible'])
    const id = item.id
    if (typeof id !== 'string' || !IDS.includes(id as DeckWidgetId) || seen.has(id as DeckWidgetId)) {
      throw new DeckLayoutValidationError()
    }
    seen.add(id as DeckWidgetId)
    const { x, y, w, h, visible } = item
    if (!safeInt(x) || !safeInt(y) || !safeInt(w) || !safeInt(h) || typeof visible !== 'boolean') {
      throw new DeckLayoutValidationError()
    }
    const [minW, minH] = MINIMUM[id as DeckWidgetId]
    if (w < minW || w > COLUMNS || h < minH || h > ROWS || x < 0 || x > COLUMNS || y < 0 || y > ROWS) {
      throw new DeckLayoutValidationError()
    }
    // Hidden widgets retain their position without occupying cells, including off-grid positions.
    if (visible) {
      if (x + w > COLUMNS || y + h > ROWS) throw new DeckLayoutValidationError()
      for (let row = y; row < y + h; row++) {
        for (let column = x; column < x + w; column++) {
          const cell = row * COLUMNS + column
          if (occupied.has(cell)) throw new DeckLayoutValidationError('deck-layout-overlap')
          occupied.add(cell)
        }
      }
    }
    return { id: id as DeckWidgetId, x, y, w, h, visible }
  })
}

function parseShortcutIds(value: unknown, limit = Infinity): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > limit) throw new DeckLayoutValidationError()
  const ids = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string' ||
        !/^(?:tool:(?:explorer|terminal|tasks|settings)|action:[a-zA-Z0-9-]{1,90})$/.test(raw) ||
        ids.has(raw)) throw new DeckLayoutValidationError()
    ids.add(raw)
  }
  return [...ids]
}

function parsePages(value: unknown): DeckPage[] {
  if (!Array.isArray(value)) throw new DeckLayoutValidationError()
  const seen = new Set<string>()
  return value.map(raw => {
    const item = record(raw)
    exactKeys(item, ['id', 'name', 'widgets', 'quickIds'])
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,90}$/.test(item.id) ||
        ['panel', 'keys'].includes(item.id) || seen.has(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new DeckLayoutValidationError()
    seen.add(item.id)
    return { id: item.id, name: item.name.trim(), widgets: parseWidgets(item.widgets), quickIds: parseShortcutIds(item.quickIds, 6) }
  })
}

function byteLimit(value: unknown): void {
  let encoded: string | undefined
  try { encoded = JSON.stringify(value) } catch { throw new DeckLayoutValidationError() }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_DECK_LAYOUT_BYTES) throw new DeckLayoutValidationError('deck-layout-too-large')
}

function parseSetInput(raw: unknown): DeckLayoutSetInput {
  byteLimit(raw)
  const item = record(raw)
  onlyKeys(item, ['baseRevision', 'widgets'], ['quickIds', 'pages', 'hideShortcutNames', 'shortcutIds'])
  if (hasOwn(item, 'hideShortcutNames') && typeof item.hideShortcutNames !== 'boolean') throw new DeckLayoutValidationError()
  if (!safeInt(item.baseRevision) || item.baseRevision < 0) throw new DeckLayoutValidationError()
  return { ...(hasOwn(item, 'shortcutIds') ? { shortcutIds: parseShortcutIds(item.shortcutIds) } : {}),
    ...(hasOwn(item, 'hideShortcutNames') ? { hideShortcutNames: item.hideShortcutNames as boolean } : {}), ...(hasOwn(item, 'pages') ? { pages: parsePages(item.pages) } : {}), baseRevision: item.baseRevision, widgets: parseWidgets(item.widgets),
    ...(hasOwn(item, 'quickIds') ? { quickIds: parseShortcutIds(item.quickIds, 6) } : {}) }
}

function parseStored(raw: unknown): DeckLayout {
  byteLimit(raw)
  const item = record(raw)
  onlyKeys(item, ['version', 'revision', 'updatedAt', 'widgets'], ['quickIds', 'pages', 'hideShortcutNames', 'shortcutIds'])
  if (hasOwn(item, 'hideShortcutNames') && typeof item.hideShortcutNames !== 'boolean') throw new DeckLayoutValidationError()
  if (item.version !== 1 || !safeInt(item.revision) || item.revision < 0 ||
      !safeInt(item.updatedAt) || item.updatedAt < 0) throw new DeckLayoutValidationError()
  return { ...(hasOwn(item, 'shortcutIds') ? { shortcutIds: parseShortcutIds(item.shortcutIds) } : {}),
    ...(hasOwn(item, 'hideShortcutNames') ? { hideShortcutNames: item.hideShortcutNames as boolean } : {}), ...(hasOwn(item, 'pages') ? { pages: parsePages(item.pages) } : {}), version: 1, revision: item.revision, updatedAt: item.updatedAt, widgets: parseWidgets(item.widgets),
    ...(hasOwn(item, 'quickIds') ? { quickIds: parseShortcutIds(item.quickIds, 6) } : {}) }
}

/** Single PC authority for the Deck geometry; synchronous CAS keeps IPC and HTTP writes serialized. */
export class DeckLayoutStore {
  private current: DeckLayout

  constructor(private readonly file: string) {
    this.current = fs.existsSync(file)
      ? parseStored(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown)
      : { version: 1, revision: 0, updatedAt: Date.now(), widgets: INITIAL_WIDGETS.map(widget => ({ ...widget })) }
  }

  get(): DeckLayout {
    return { ...this.current, ...(this.current.shortcutIds ? { shortcutIds: this.current.shortcutIds.slice() } : {}), ...(this.current.pages ? { pages: structuredClone(this.current.pages) } : {}), widgets: this.current.widgets.map(widget => ({ ...widget })),
      ...(this.current.quickIds === undefined ? {} : { quickIds: this.current.quickIds?.slice() ?? null }) }
  }

  set(value: unknown): DeckLayout {
    const incoming = parseSetInput(value)
    if (incoming.baseRevision !== this.current.revision) throw new DeckLayoutConflictError(this.get())
    if (this.current.revision === Number.MAX_SAFE_INTEGER) throw new DeckLayoutValidationError('revision-exhausted')
    const shortcutIds = incoming.shortcutIds === undefined ? this.current.shortcutIds : incoming.shortcutIds
    const updated: DeckLayout = {
      ...(shortcutIds === undefined ? {} : { shortcutIds }),
      hideShortcutNames: incoming.hideShortcutNames ?? this.current.hideShortcutNames ?? false,
      ...(incoming.pages !== undefined ? { pages: incoming.pages } : this.current.pages ? { pages: this.current.pages } : {}),
      version: 1, revision: this.current.revision + 1, updatedAt: Date.now(), widgets: incoming.widgets,
      ...(incoming.quickIds !== undefined ? { quickIds: incoming.quickIds } :
        this.current.quickIds !== undefined ? { quickIds: this.current.quickIds } : {}),
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = this.file + '.' + randomUUID() + '.tmp'
    try {
      fs.writeFileSync(temp, JSON.stringify(updated), { flag: 'wx', mode: 0o600, flush: true })
      fs.renameSync(temp, this.file)
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
    this.current = updated
    return this.get()
  }
}
