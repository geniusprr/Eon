export type StudioKind = 'phone' | 'clock' | 'cpu' | 'memory' | 'gpu' | 'disk' | 'media' | 'shortcuts' | 'notes' | 'devices' | 'uptime'
export type StudioPreset = 'balanced' | 'phone' | 'system' | 'minimal'
export type StudioColumns = 12 | 8 | 6 | 4
export type StudioTile = { id: StudioKind; x: number; y: number; w: number; h: number }
export type StudioLayouts = Record<StudioColumns, StudioTile[]>
export type StudioState = { version: 2; preset: StudioPreset | 'custom'; layouts: StudioLayouts }

export const studioColumns: readonly StudioColumns[] = [12, 8, 6, 4]
export const studioKinds: readonly StudioKind[] = ['phone', 'clock', 'cpu', 'memory', 'gpu', 'disk', 'media', 'shortcuts', 'notes', 'devices', 'uptime']

export const studioPresets: Array<{ id: StudioPreset; title: string; description: string }> = [
  { id: 'balanced', title: 'Dengeli', description: 'Telefon, sistem ve üretkenlik bir arada' },
  { id: 'phone', title: 'Telefon odaklı', description: 'Büyük telefon görünümü, hızlı kontrol' },
  { id: 'system', title: 'Sistem', description: 'Canlı metrikler ve PC yönetimi' },
  { id: 'minimal', title: 'Minimal', description: 'Geniş, sade çalışma alanı' },
]

const widgetMin: Record<StudioKind, { w: number; h: number }> = {
  phone: { w: 3, h: 6 }, clock: { w: 2, h: 2 }, cpu: { w: 2, h: 2 }, memory: { w: 2, h: 2 },
  gpu: { w: 2, h: 2 }, disk: { w: 2, h: 2 }, media: { w: 3, h: 3 }, shortcuts: { w: 3, h: 3 },
  notes: { w: 3, h: 3 }, devices: { w: 2, h: 2 }, uptime: { w: 2, h: 2 },
}

export function tileMin(kind: StudioKind, columns: StudioColumns) {
  const min = widgetMin[kind]
  return { w: Math.min(columns, kind === 'phone' ? columns <= 4 ? 2 : 3 : min.w), h: min.h }
}

const t = (id: StudioKind, x: number, y: number, w: number, h: number): StudioTile => ({ id, x, y, w, h })

const templates: Record<StudioPreset, StudioTile[]> = {
  balanced: [
    t('phone', 0, 0, 4, 8), t('clock', 4, 0, 4, 2), t('cpu', 8, 0, 2, 2),
    t('memory', 10, 0, 2, 2), t('media', 4, 2, 5, 3), t('shortcuts', 9, 2, 3, 4),
    t('notes', 4, 5, 5, 3), t('devices', 9, 6, 3, 2), t('disk', 0, 8, 2, 2),
    t('gpu', 2, 8, 2, 2), t('uptime', 4, 8, 3, 2),
  ],
  phone: [
    t('phone', 0, 0, 6, 10), t('clock', 6, 0, 3, 2), t('devices', 9, 0, 3, 2),
    t('media', 6, 2, 6, 3), t('shortcuts', 6, 5, 6, 3), t('cpu', 6, 8, 3, 2),
    t('memory', 9, 8, 3, 2), t('notes', 0, 10, 6, 3),
  ],
  system: [
    t('cpu', 0, 0, 2, 2), t('memory', 2, 0, 2, 2), t('gpu', 4, 0, 2, 2),
    t('disk', 6, 0, 2, 2), t('phone', 8, 0, 4, 8), t('clock', 0, 2, 3, 2),
    t('uptime', 3, 2, 2, 2), t('devices', 5, 2, 3, 2), t('media', 0, 4, 4, 4),
    t('shortcuts', 4, 4, 4, 4), t('notes', 8, 8, 4, 3),
  ],
  minimal: [
    t('phone', 0, 0, 6, 9), t('clock', 6, 0, 6, 3),
    t('media', 6, 3, 6, 3), t('notes', 6, 6, 6, 3),
  ],
}

const overlap = (a: StudioTile, b: StudioTile) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export const hasCollision = (tiles: StudioTile[]) => tiles.some((tile, i) => tiles.slice(i + 1).some(other => overlap(tile, other)))

/**
 * The actively moved card owns its target cell. Other cards are pushed down,
 * keeping their individual sizes and preserving every card exactly once.
 */
export function placeTile(layout: StudioTile[], changed: StudioTile, columns: StudioColumns): StudioTile[] {
  const min = tileMin(changed.id, columns)
  const w = Math.min(columns, Math.max(min.w, Math.round(changed.w)))
  const h = Math.min(16, Math.max(min.h, Math.round(changed.h)))
  const pinned: StudioTile = { ...changed, w, h, x: Math.min(columns - w, Math.max(0, Math.round(changed.x))), y: Math.min(120, Math.max(0, Math.round(changed.y))) }
  const placed: StudioTile[] = [pinned]
  for (const original of layout) {
    if (original.id === pinned.id) continue
    const limit = tileMin(original.id, columns)
    const candidate = { ...original,
      w: Math.min(columns, Math.max(limit.w, Math.round(original.w))),
      h: Math.min(16, Math.max(limit.h, Math.round(original.h))),
    }
    candidate.x = Math.max(0, Math.min(columns - candidate.w, candidate.x))
    candidate.y = Math.max(0, candidate.y)
    while (placed.some(other => overlap(candidate, other))) candidate.y++
    placed.push(candidate)
  }
  return layout.some(item => item.id === pinned.id)
    ? layout.map(item => placed.find(position => position.id === item.id)!)
    : placed
}

export function layoutForPreset(preset: StudioPreset, columns: StudioColumns): StudioTile[] {
  const layout: StudioTile[] = []
  for (const source of templates[preset]) {
    const scaled = columns === 12 ? source : {
      ...source,
      x: Math.round(source.x * columns / 12),
      w: source.id === 'phone' && columns <= 6 ? columns : Math.round(source.w * columns / 12),
    }
    const min = tileMin(scaled.id, columns)
    // Keep earlier preset anchors (especially the phone) in place. When a
    // narrower breakpoint causes a collision, only the arriving tile moves.
    const tile = {
      ...scaled,
      w: Math.max(min.w, Math.min(columns, scaled.w)),
      h: Math.max(min.h, scaled.h),
    }
    tile.x = Math.max(0, Math.min(columns - tile.w, tile.x))
    tile.y = Math.max(0, tile.y)
    const preferredX = tile.x
    const candidateColumns = Array.from({ length: columns - tile.w + 1 }, (_, index) => index)
      .sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX) || b - a)
    while (true) {
      const freeColumn = candidateColumns.find(x => !layout.some(existing => overlap({ ...tile, x }, existing)))
      if (freeColumn !== undefined) { tile.x = freeColumn; break }
      tile.y++
    }
    layout.push(tile)
  }
  return layout
}

export function createStudioState(preset: StudioPreset = 'balanced'): StudioState {
  return { version: 2, preset, layouts: {
    12: layoutForPreset(preset, 12), 8: layoutForPreset(preset, 8),
    6: layoutForPreset(preset, 6), 4: layoutForPreset(preset, 4),
  } }
}

export function readStudioState(value: unknown): StudioState {
  if (!value || typeof value !== 'object') return createStudioState()
  const record = value as Partial<StudioState>
  if (record.version !== 2 || !record.layouts || typeof record.layouts !== 'object') return createStudioState()
  const layouts = {} as StudioLayouts
  for (const columns of studioColumns) {
    const tiles: unknown = record.layouts[columns]
    if (!Array.isArray(tiles) || tiles.length > studioKinds.length) return createStudioState()
    const ids = new Set<string>()
    const checked: StudioTile[] = []
    for (const item of tiles) {
      if (!item || typeof item !== 'object') return createStudioState()
      const tile = item as StudioTile
      if (!studioKinds.includes(tile.id) || ids.has(tile.id) ||
          ![tile.x, tile.y, tile.w, tile.h].every(Number.isInteger) ||
          tile.x < 0 || tile.y < 0 || tile.y > 120 || tile.w < tileMin(tile.id, columns).w ||
          tile.h < tileMin(tile.id, columns).h || tile.h > 16 || tile.x + tile.w > columns ||
          checked.some(other => overlap(tile, other))) return createStudioState()
      ids.add(tile.id)
      checked.push({ ...tile })
    }
    layouts[columns] = checked
  }
  const ids = studioColumns.map(columns => layouts[columns].map(tile => tile.id).sort().join(','))
  if (!ids.every(key => key === ids[0])) return createStudioState()
  const preset = studioPresets.some(item => item.id === record.preset) ? record.preset as StudioPreset : 'custom'
  // Preset tiles are derived, not hand-edited. Recalculate after responsive
  // layout fixes so a profile saved with the older narrow-screen geometry
  // cannot strand the phone far below the visible dashboard.
  if (preset !== 'custom') return createStudioState(preset)
  return { version: 2, preset, layouts }
}

export function addStudioKind(state: StudioState, kind: StudioKind): StudioState {
  const next = { ...state.layouts }
  for (const columns of studioColumns) {
    if (next[columns].some(tile => tile.id === kind)) continue
    const min = tileMin(kind, columns)
    const y = next[columns].reduce((max, tile) => Math.max(max, tile.y + tile.h), 0)
    next[columns] = placeTile(next[columns], { id: kind, x: 0, y, w: Math.min(columns, Math.max(min.w, kind === 'phone' ? 4 : min.w + 1)), h: min.h }, columns)
  }
  return { version: 2, preset: 'custom', layouts: next }
}

export function removeStudioKind(state: StudioState, kind: StudioKind): StudioState {
  return { version: 2, preset: 'custom', layouts: {
    12: state.layouts[12].filter(tile => tile.id !== kind),
    8: state.layouts[8].filter(tile => tile.id !== kind),
    6: state.layouts[6].filter(tile => tile.id !== kind),
    4: state.layouts[4].filter(tile => tile.id !== kind),
  } }
}
