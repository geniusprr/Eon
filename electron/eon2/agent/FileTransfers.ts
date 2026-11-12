import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FILE_CHUNK_BYTES, type TransferFile } from '../../../shared/eon-controls.js'

interface Entry { info: TransferFile; path: string; finalPath?: string; touched: number }
const MAX_FILE_BYTES = 8 * 1024 ** 3
/** LocalSend file metadata, carried in the authenticated Eon protocol. No LAN listener. */
export class FileTransfers {
  private readonly entries = new Map<string, Entry>()
  private readonly busy = new Set<string>()
  constructor(private directory: string, private readonly settingsPath?: string) {
    if (settingsPath) {
      try {
        const saved: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
        if (typeof saved !== 'string' || !path.isAbsolute(saved)) throw new Error('Geçersiz aktarım klasörü.')
        this.directory = saved
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  getDirectory() { return this.directory }
  async setDirectory(directory: string) {
    if (!path.isAbsolute(directory)) throw new Error('Mutlak bir klasör yolu seç.')
    await fs.mkdir(directory, { recursive: true })
    const probe = path.join(directory, `.eon-${randomUUID()}.tmp`)
    await fs.writeFile(probe, '', { flag: 'wx' })
    await fs.unlink(probe)
    if (this.settingsPath) {
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true })
      const temporary = `${this.settingsPath}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify(directory), { flag: 'wx' })
        await fs.rename(temporary, this.settingsPath)
      } finally { await fs.rm(temporary, { force: true }) }
    }
    this.directory = directory
    return directory
  }
  completedPath(id: string) {
    const entry = this.entries.get(id)
    if (!entry || entry.info.direction !== 'receive' || entry.info.state !== 'completed') throw new Error('Alınan dosya henüz hazır değil.')
    return entry.path
  }
  list(deviceId?: string) { return [...this.entries.values()].filter(entry => !deviceId || entry.info.deviceId === deviceId).map(entry => ({ ...entry.info })) }
  async offer(paths: string[], deviceId: string) {
    if (!/^[a-zA-Z0-9_-]{8,90}$/.test(deviceId) || paths.length < 1 || paths.length > 20) throw new Error('Geçersiz cihaz veya dosya sayısı.')
    const files = await Promise.all(paths.map(async source => {
      const stat = await fs.stat(source)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Dosya normal bir dosya olmalı ve 8 GB sınırını aşmamalı.')
      return { source, size: stat.size }
    }))
    this.checkCapacity(files.length)
    for (const { source, size } of files) {
      const id = randomUUID()
      this.entries.set(id, { path: source, touched: Date.now(), info: { id, fileName: path.basename(source), size, fileType: 'application/octet-stream', direction: 'send', deviceId, transferred: 0, state: 'queued' } })
    }
    return this.list()
  }
  async prepare(deviceId: string, value: unknown) {
    const input = record(value)
    if (typeof input.fileName !== 'string' || !input.fileName || input.fileName.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(input.fileName) || /[. ]$/.test(input.fileName) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(input.fileName) ||
      !Number.isSafeInteger(input.size) || Number(input.size) < 0 || Number(input.size) > MAX_FILE_BYTES) throw new Error('Geçersiz dosya bilgisi.')
    this.checkCapacity()
    const active = this.list().filter(file => file.direction === 'receive' && file.state === 'transferring')
    if (active.filter(file => file.deviceId === deviceId).length >= 4 || active.reduce((sum, file) => sum + file.size, 0) + Number(input.size) > 32 * 1024 ** 3) throw new Error('Etkin aktarım kotası dolu; önce bekleyen aktarımları tamamla veya iptal et.')
    const directory = this.directory
    await fs.mkdir(directory, { recursive: true })
    const id = randomUUID()
    const destination = path.join(directory, `${id}-${input.fileName}`)
    const temporary = path.join(directory, `${id}.part`)
    await fs.writeFile(temporary, Buffer.alloc(0), { flag: 'wx' })
    const info: TransferFile = { id, fileName: input.fileName, size: Number(input.size), fileType: 'application/octet-stream', direction: 'receive', deviceId, transferred: 0, state: 'transferring' }
    this.entries.set(id, { info, path: temporary, finalPath: destination, touched: Date.now() })
    return { id, chunkSize: FILE_CHUNK_BYTES }
  }
  async chunk(deviceId: string, value: unknown) {
    const input = record(value)
    const entry = this.owned(deviceId, input.id)
    if (this.busy.has(entry.info.id)) throw new Error('Dosya meşgul.')
    if (!Number.isSafeInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > entry.info.size) throw new Error('Geçersiz dosya konumu.')
    this.busy.add(entry.info.id)
    try {
      const offset = Number(input.offset)
      if (entry.info.direction === 'send') {
        if (entry.info.state === 'cancelled') throw new Error('Aktarım iptal edilmiş.')
        const handle = await fs.open(entry.path, 'r')
        try {
          const stat = await handle.stat()
          if (stat.size !== entry.info.size) throw new Error('Kaynak dosya değişti; yeniden seç.')
          const buffer = Buffer.alloc(Math.min(FILE_CHUNK_BYTES, entry.info.size - offset))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
          entry.info.transferred = offset + bytesRead
          entry.info.state = 'transferring'
          entry.touched = Date.now()
          return { id: entry.info.id, data: buffer.subarray(0, bytesRead).toString('base64'), offset, size: entry.info.size }
        } finally { await handle.close() }
      }
      if (entry.info.state !== 'transferring' || offset !== entry.info.transferred || typeof input.data !== 'string' || input.data.length > Math.ceil(FILE_CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error('Geçersiz dosya parçası veya sıra.')
      const bytes = Buffer.from(input.data, 'base64')
      if (!bytes.length || bytes.length > FILE_CHUNK_BYTES || offset + bytes.length > entry.info.size) throw new Error('Dosya boyutu aşılmış.')
      const handle = await fs.open(entry.path, 'r+')
      try {
        let written = 0
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, offset + written)
          if (!result.bytesWritten) throw new Error('Dosyaya yazılamadı.')
          written += result.bytesWritten
        }
        await handle.truncate(offset + bytes.length)
      } finally { await handle.close() }
      entry.info.transferred += bytes.length
      entry.touched = Date.now()
      return { offset: entry.info.transferred }
    } finally { this.busy.delete(entry.info.id) }
  }
  async finish(deviceId: string, value: unknown) {
    const entry = this.owned(deviceId, record(value).id)
    if (this.busy.has(entry.info.id) || entry.info.transferred !== entry.info.size || entry.info.state === 'cancelled') throw new Error('Dosya aktarımı tamamlanmadı.')
    this.busy.add(entry.info.id)
    try {
      if (entry.info.direction === 'receive' && entry.info.state !== 'completed') {
        const handle = await fs.open(entry.path, 'r+')
        try {
          if ((await handle.stat()).size !== entry.info.size) throw new Error('Dosya boyutu uyuşmuyor.')
          await handle.sync()
        } finally { await handle.close() }
        await fs.rename(entry.path, entry.finalPath!)
        entry.path = entry.finalPath!
      }
      entry.info.state = 'completed'
      return { ok: true }
    } finally { this.busy.delete(entry.info.id) }
  }
  async cancel(id: string) {
    const entry = this.entries.get(id)
    if (!entry || this.busy.has(id) || entry.info.state === 'completed') throw new Error('Aktarım iptal edilemiyor.')
    entry.info.state = 'cancelled'
    if (entry.info.direction === 'receive') await fs.rm(entry.path, { force: true })
    return true
  }
  async close() {
    for (const entry of this.entries.values()) if (entry.info.direction === 'receive' && entry.info.state !== 'completed') await fs.rm(entry.path, { force: true })
  }
  private owned(deviceId: string, id: unknown) {
    const entry = typeof id === 'string' ? this.entries.get(id) : undefined
    if (!entry || entry.info.deviceId !== deviceId) throw new Error('Bu dosyaya erişim yok.')
    return entry
  }
  private checkCapacity(additional = 1) {
    for (const [id, entry] of this.entries) if (entry.info.state === 'completed' || entry.info.state === 'cancelled') {
      if (Date.now() - entry.touched > 3600_000) this.entries.delete(id)
    }
    if (this.entries.size + additional > 100) throw new Error('Aktarım kuyruğu dolu; tamamlanmış kayıtların süresinin dolmasını bekle.')
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz istek.')
  return value as Record<string, unknown>
}
