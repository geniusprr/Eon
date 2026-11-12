import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PcAction, PcActionKind } from '../../../shared/eon-controls.js'
import { actionIconIds, type ActionIconId } from '../../../shared/eon-controls.js'

const kinds: PcActionKind[] = ['application', 'file', 'command', 'lock', 'shutdown', 'restart', 'cancel']
export function parseAction(value: unknown): PcAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz kısayol.')
  const input = value as Record<string, unknown>
  if (input.icon !== undefined && !actionIconIds.includes(input.icon as ActionIconId)) throw new Error('Geçersiz kısayol simgesi.')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 ||
      !kinds.includes(input.kind as PcActionKind) || typeof input.target !== 'string' || input.target.length > 4096 || input.target.includes('\0') ||
      !Array.isArray(input.arguments) || input.arguments.length > 32 || !input.arguments.every(arg => typeof arg === 'string' && arg.length <= 2048 && !arg.includes('\0')) ||
      !Number.isInteger(input.delaySeconds) || Number(input.delaySeconds) < 0 || Number(input.delaySeconds) > 604800 || typeof input.remoteEnabled !== 'boolean') throw new Error('Kısayol alanları geçersiz.')
  if (input.id !== undefined && (typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{1,90}$/.test(input.id))) throw new Error('Geçersiz kısayol kimliği.')
  if ((input.kind === 'application' || input.kind === 'command') && !input.target.trim()) throw new Error('Uygulama veya komut gir.')
  if (input.kind === 'application' && (!path.win32.isAbsolute(input.target) || !/\.(exe|lnk)$/i.test(input.target))) throw new Error('Uygulama için tam .exe veya .lnk yolunu seç.')
  if (input.kind === 'application' && /\.lnk$/i.test(input.target) && input.arguments.length) throw new Error('Windows kısayolunun argümanlarını .lnk dosyasında düzenle.')
  if (input.kind === 'file' && !/^[A-Za-z]:[\\/]/.test(input.target)) throw new Error('Yerel dosyanın tam yolunu seç.')
  return { id: typeof input.id === 'string' ? input.id : randomUUID(), name: input.name.trim(), kind: input.kind as PcActionKind,
    target: input.target, arguments: input.arguments as string[], delaySeconds: Number(input.delaySeconds), remoteEnabled: input.remoteEnabled,
    ...(input.icon === undefined ? {} : { icon: input.icon as ActionIconId }) }
}

export class PcActions {
  private actions: PcAction[]
  private busy = false
  constructor(private readonly file: string, private readonly run: (action: PcAction) => Promise<unknown>) {
    if (fs.existsSync(file)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Kısayol deposu bozuk.')
      this.actions = parsed.map(parseAction)
    } else this.actions = [
      { id: 'lock', name: 'Windows’u kilitle', kind: 'lock', target: '', arguments: [], delaySeconds: 0, remoteEnabled: true },
      { id: 'shutdown', name: '30 dk sonra kapat', kind: 'shutdown', target: '', arguments: [], delaySeconds: 1800, remoteEnabled: true },
      { id: 'restart', name: 'Yeniden başlat', kind: 'restart', target: '', arguments: [], delaySeconds: 60, remoteEnabled: true },
      { id: 'cancel', name: 'Güç planını iptal et', kind: 'cancel', target: '', arguments: [], delaySeconds: 0, remoteEnabled: true },
    ]
  }
  list() { return this.actions.map(action => ({ ...action, arguments: [...action.arguments] })) }
  save(value: unknown, remote = false) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    const existing = typeof input?.id === 'string' ? this.actions.find(item => item.id === input.id) : undefined
    // Only omitted desktop fields receive a default; explicit saved decisions are retained.
    const action = parseAction(input && input.remoteEnabled === undefined
      ? { ...input, remoteEnabled: remote ? false : existing?.remoteEnabled ?? true }
      : value)
    // A paired phone with shortcut access can create and update shortcuts.
    if (remote) action.remoteEnabled = true
    const next = [...this.actions.filter(item => item.id !== action.id), action]
    if (next.length > 100) throw new Error('En fazla 100 kısayol kaydedilebilir.')
    this.persist(next)
    return action
  }
  remove(id: string) { this.persist(this.actions.filter(action => action.id !== id)); return true }
  async execute(id: string, remote = false) {
    const action = this.actions.find(item => item.id === id)
    if (!action || (remote && !action.remoteEnabled)) throw new Error('Kısayol PC üzerinden onaylanmamış.')
    if (this.busy) throw new Error('Önceki komutun tamamlanmasını bekle.')
    this.busy = true
    try { await this.run({ ...action, arguments: [...action.arguments] }); return { ok: true, name: action.name } }
    finally { this.busy = false }
  }
  private persist(next: PcAction[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file) }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    this.actions = next
  }
}
