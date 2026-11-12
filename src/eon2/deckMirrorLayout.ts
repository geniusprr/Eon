export type DeckTileId = 'clock' | 'cpu' | 'gpu' | 'ram' | 'disk' | 'media' | 'shortcuts'
export type DeckTile = { id: DeckTileId; x: number; y: number; w: number; h: number; visible: boolean }
export type { DeckLayout, DeckPage } from '../../shared/contracts'
import type { DeckLayout, DeckPage } from '../../shared/contracts'
export type DeckPreset = 'balanced' | 'shortcuts' | 'media' | 'minimal'

export const DECK_COLUMNS = 12
export const DECK_ROWS = 6
export const DECK_ORDER: readonly DeckTileId[] = ['clock', 'cpu', 'gpu', 'ram', 'disk', 'media', 'shortcuts']
const point = (id: DeckTileId, x: number, y: number, w: number, h: number, visible = true): DeckTile => ({ id, x, y, w, h, visible })
const requiredSize: Record<DeckTileId, [number, number]> = {
  clock: [2, 2], cpu: [1, 2], gpu: [1, 2], ram: [1, 2], disk: [1, 2],
  media: [3, 2], shortcuts: [3, 2],
}
export const DECK_PRESETS: ReadonlyArray<{ id: DeckPreset; name: string; info: string }> = [
  { id: 'balanced', name: 'Dengeli', info: 'Telefondaki standart yatay Deck' },
  { id: 'shortcuts', name: 'Kısayollar', info: 'Komutlara daha geniş alan' },
  { id: 'media', name: 'Medya', info: 'Müzik ve ses için geniş panel' },
  { id: 'minimal', name: 'Minimal', info: 'Daha büyük saat ve temel ölçümler' },
]

export function deckPreset(preset: DeckPreset): DeckTile[] {
  switch (preset) {
    case 'shortcuts': return [
      point('clock', 0, 0, 4, 2), point('cpu', 4, 0, 2, 2), point('gpu', 6, 0, 2, 2),
      point('ram', 8, 0, 2, 2), point('disk', 10, 0, 2, 2), point('media', 0, 2, 4, 4),
      point('shortcuts', 4, 2, 8, 4),
    ]
    case 'media': return [
      point('clock', 0, 0, 4, 2), point('cpu', 4, 0, 2, 2), point('gpu', 6, 0, 2, 2),
      point('ram', 8, 0, 2, 2), point('disk', 10, 0, 2, 2), point('media', 0, 2, 7, 4),
      point('shortcuts', 7, 2, 5, 4),
    ]
    case 'minimal': return [
      point('clock', 0, 0, 5, 3), point('cpu', 5, 0, 3, 3), point('gpu', 6, 0, 2, 2, false),
      point('ram', 8, 0, 4, 3), point('disk', 10, 0, 2, 2, false), point('media', 0, 3, 6, 3),
      point('shortcuts', 6, 3, 6, 3),
    ]
    default: return [
      point('clock', 0, 0, 4, 2), point('cpu', 4, 0, 2, 3), point('gpu', 6, 0, 2, 3),
      point('ram', 8, 0, 2, 3), point('disk', 10, 0, 2, 3), point('media', 0, 2, 4, 4),
      point('shortcuts', 4, 3, 8, 3),
    ]
  }
}

export function defaultDeckLayout(): DeckLayout {
  return { version: 1, revision: 0, updatedAt: 0, widgets: deckPreset('balanced') }
}

export function deckOverlap(a: DeckTile, b: DeckTile): boolean {
  return a.visible && b.visible && a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y
}

export function validDeckWidgets(items: DeckTile[]): boolean {
  if (items.length !== DECK_ORDER.length) return false
  const ids = new Set<string>()
  for (const item of items) {
    if (!DECK_ORDER.includes(item.id) || ids.has(item.id) || typeof item.visible !== 'boolean') return false
    ids.add(item.id)
    if (![item.x, item.y, item.w, item.h].every(Number.isInteger)) return false
    if (item.x < 0 || item.y < 0 || item.x > DECK_COLUMNS || item.y > DECK_ROWS) return false
    // The authenticated store keeps hidden cards' last geometry even if part
    // of that rectangle lies outside the current canvas.
    if (item.visible && (item.y + item.h > DECK_ROWS || item.x + item.w > DECK_COLUMNS)) return false
    if (item.w < requiredSize[item.id][0] || item.h < requiredSize[item.id][1]) return false
    if (items.some(other => item !== other && deckOverlap(item, other))) return false
  }
  return true
}

function validShortcutIds(value: unknown, limit = Infinity): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length <= limit &&
    new Set(value).size === value.length &&
    value.every(id => typeof id === 'string' && /^(?:tool:(?:explorer|terminal|tasks|settings)|action:[a-zA-Z0-9-]{1,90})$/.test(id)))
}

export function validateDeckLayout(value: unknown): DeckLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Partial<DeckLayout>
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || (data.revision ?? -1) < 0 ||
    !Number.isSafeInteger(data.updatedAt) || (data.updatedAt ?? -1) < 0 ||
    !Array.isArray(data.widgets) || !validDeckWidgets(data.widgets)) return null
  if (!validShortcutIds(data.quickIds, 6) || !validShortcutIds(data.shortcutIds)) return null
  if (data.hideShortcutNames !== undefined && typeof data.hideShortcutNames !== 'boolean') return null
  let pages: DeckPage[] | undefined
  if (data.pages !== undefined) {
    if (!Array.isArray(data.pages)) return null
    const ids = new Set<string>()
    pages = []
    for (const page of data.pages) {
      if (!page || typeof page.id !== 'string' || !/^[a-zA-Z0-9-]{1,90}$/.test(page.id) ||
          ['panel', 'keys'].includes(page.id) || ids.has(page.id) || typeof page.name !== 'string' ||
          !page.name.trim() || page.name.length > 80 ||
          !validateDeckLayout({ version: 1, revision: 0, updatedAt: 0, widgets: page.widgets, quickIds: page.quickIds })) return null
      ids.add(page.id)
      pages.push(structuredClone(page))
    }
  }
  return { ...(data.shortcutIds === undefined ? {} : { shortcutIds: data.shortcutIds?.slice() ?? null }),
    ...(data.hideShortcutNames === undefined ? {} : { hideShortcutNames: data.hideShortcutNames }), ...(pages ? { pages } : {}), version: 1, revision: data.revision!, updatedAt: data.updatedAt!,
    widgets: data.widgets.map(item => ({ ...item })),
    ...(data.quickIds === undefined ? {} : { quickIds: data.quickIds?.slice() ?? null }) }
}

/** One edit is atomic; a collision leaves the previous layout intact. */
export function patchDeckTile(items: DeckTile[], next: DeckTile): DeckTile[] | null {
  const updated = items.map(item => item.id === next.id ? { ...next } : { ...item })
  return validDeckWidgets(updated) ? updated : null
}

export function clampDeckTile(tile: DeckTile, updates: Partial<Pick<DeckTile, 'x' | 'y' | 'w' | 'h'>>): DeckTile {
  const desired = { ...tile, ...updates }
  const [minW, minH] = requiredSize[tile.id]
  const w = Math.max(minW, Math.min(DECK_COLUMNS, Math.round(desired.w)))
  const h = Math.max(minH, Math.min(DECK_ROWS, Math.round(desired.h)))
  return { ...desired, w, h,
    x: Math.max(0, Math.min(DECK_COLUMNS - w, Math.round(desired.x))),
    y: Math.max(0, Math.min(DECK_ROWS - h, Math.round(desired.y))) }
}

/** Place one widget into an occupied 12×6 canvas, moving and shrinking neighbours when needed.
 * Never removes or hides other widgets. A bounded beam search keeps pointer-drop responsive.
 */
export function reflowDeckTile(items: DeckTile[], chosen: DeckTile): DeckTile[] | null {
  const direct = patchDeckTile(items, chosen)
  if (direct) return direct
  if (!chosen.visible || !items.some(tile => tile.id === chosen.id)) return null
  if (chosen.x < 0 || chosen.y < 0 || chosen.x + chosen.w > DECK_COLUMNS || chosen.y + chosen.h > DECK_ROWS) return null
  const min: Record<DeckTileId, [number, number]> = {
    clock: [2, 2], cpu: [1, 2], gpu: [1, 2], ram: [1, 2], disk: [1, 2],
    media: [3, 2], shortcuts: [3, 2],
  }
  const others = items.filter(tile => tile.id !== chosen.id && tile.visible)
    .sort((a, b) => b.w * b.h - a.w * a.h)
  type Candidate = { placed: DeckTile[]; score: number }
  let frontier: Candidate[] = [{ placed: [chosen], score: 0 }]
  const allPositions = (tile: DeckTile): Array<{ tile: DeckTile; cost: number }> => {
    const positions: Array<{ tile: DeckTile; cost: number }> = []
    const [minW, minH] = min[tile.id]
    for (let w = tile.w; w >= minW; w--) for (let h = tile.h; h >= minH; h--) {
      for (let y = 0; y <= DECK_ROWS - h; y++) for (let x = 0; x <= DECK_COLUMNS - w; x++) {
        const distance = Math.abs(x - tile.x) + Math.abs(y - tile.y)
        const areaLost = tile.w * tile.h - w * h
        const cost = distance * 2 + areaLost * 4 + (distance > 0 ? 6 : 0)
        positions.push({ tile: { ...tile, x, y, w, h }, cost })
      }
    }
    positions.sort((a, b) => a.cost - b.cost || a.tile.y - b.tile.y || a.tile.x - b.tile.x)
    return positions.slice(0, 180)
  }
  for (const original of others) {
    const next: Candidate[] = []
    const possibilities = allPositions(original)
    for (const state of frontier) {
      for (const { tile, cost } of possibilities) {
        if (!state.placed.some(other => deckOverlap(tile, other))) {
          next.push({ placed: [...state.placed, tile], score: state.score + cost })
        }
      }
    }
    if (!next.length) return null
    next.sort((a, b) => a.score - b.score)
    frontier = next.slice(0, 48)
  }
  for (const final of frontier) {
    const merged = items.map(original => final.placed.find(tile => tile.id === original.id) ?? original)
    if (validDeckWidgets(merged)) return merged
  }
  return null
}

export type DeckEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Keep the opposite edge fixed, including when the minimum size is reached. */
export function resizeDeckTile(tile: DeckTile, edge: DeckEdge, dx: number, dy: number): DeckTile {
  const [minW, minH] = requiredSize[tile.id]
  const left = edge.includes('w') ? Math.max(0, Math.min(tile.x + tile.w - minW, tile.x + dx)) : tile.x
  const top = edge.includes('n') ? Math.max(0, Math.min(tile.y + tile.h - minH, tile.y + dy)) : tile.y
  const right = edge.includes('e') ? Math.min(DECK_COLUMNS, Math.max(tile.x + minW, tile.x + tile.w + dx)) : tile.x + tile.w
  const bottom = edge.includes('s') ? Math.min(DECK_ROWS, Math.max(tile.y + minH, tile.y + tile.h + dy)) : tile.y + tile.h
  return { ...tile, x: left, y: top, w: right - left, h: bottom - top }
}

/** Swap occupied slots on drag, preserving the same non-overlapping wire layout. */
export function moveDeckTile(items: DeckTile[], next: DeckTile): DeckTile[] | null {
  const direct = patchDeckTile(items, next)
  if (direct) return direct
  const original = items.find(item => item.id === next.id)
  const collisions = items.filter(item => item.id !== next.id && deckOverlap(item, next))
  if (!original || collisions.length !== 1) return null
  const other = collisions[0]
  const swapped = items.map(item => item.id === next.id ? { ...next } : item.id === other.id
    ? { ...item, x: original.x, y: original.y } : { ...item })
  return validDeckWidgets(swapped) ? swapped : null
}
