import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

export interface PairedDevice {
  id: string
  name: string
  pairedAt: number
  permissions: ('system.read' | 'notes.read' | 'notes.write' | 'files.transfer' | 'actions.execute' | 'power.manage')[]
}

interface EncryptedDevice extends PairedDevice {
  secretEncrypted: string
  revoked: boolean
  fullAccessMigrated?: boolean
  permissionExpiresAt?: Partial<Record<'files.transfer' | 'actions.execute' | 'power.manage', number>>
}

export class DeviceCredentials {
  private readonly filePath: string
  private devices: EncryptedDevice[]

  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true })
    this.filePath = path.join(directory, 'paired-devices.json')
    this.devices = this.read()
    let migrated = false
    for (const device of this.devices) {
      if (!device.revoked && !device.fullAccessMigrated) {
        device.permissions = [...new Set([...device.permissions, 'files.transfer' as const, 'actions.execute' as const, 'power.manage' as const])]
        device.fullAccessMigrated = true
        delete device.permissionExpiresAt
        migrated = true
      }
    }
    if (migrated) this.persist()
  }

  get supportsEncryption(): boolean { return safeStorage.isEncryptionAvailable() }

  issue(id: string, name: string): { device: PairedDevice; secret: string } {
    if (!this.supportsEncryption) throw new Error('Windows şifreli kimlik kasası kullanılamıyor.')
    if (!/^[a-zA-Z0-9_-]{8,90}$/.test(id)) throw new Error('Geçersiz cihaz kimliği.')
    if (!name.trim() || name.length > 80) throw new Error('Geçersiz cihaz adı.')
    const secret = randomBytes(32).toString('base64url')
    const record: EncryptedDevice = {
      id, name: name.trim(), pairedAt: Date.now(),
      permissions: ['system.read', 'notes.read', 'notes.write', 'files.transfer', 'actions.execute', 'power.manage'],
      fullAccessMigrated: true,
      secretEncrypted: safeStorage.encryptString(secret).toString('base64'),
      revoked: false,
    }
    const previous = this.devices
    this.devices = [...this.devices.filter(item => item.id !== id), record]
    try { this.persist() } catch (error) { this.devices = previous; throw error }
    return { device: this.publicRecord(record), secret }
  }

  resolve(id: string): { device: PairedDevice; secret: string } | null {
    const record = this.devices.find(device => device.id === id && !device.revoked)
    if (!record || !this.supportsEncryption) return null
    try {
      const secret = safeStorage.decryptString(Buffer.from(record.secretEncrypted, 'base64'))
      return { device: this.publicRecord(record), secret }
    } catch { return null }
  }

  list(): PairedDevice[] {
    return this.devices.filter(device => !device.revoked).map(device => this.publicRecord(device))
  }

  setPermission(id: string, permission: 'files.transfer' | 'actions.execute' | 'power.manage', enabled: boolean) {
    const device = this.devices.find(item => item.id === id && !item.revoked)
    if (!device) throw new Error('Eşleştirilmiş cihaz bulunamadı.')
    const before = device.permissions
    const previousExpiry = device.permissionExpiresAt
    device.permissions = enabled ? [...new Set([...before, permission])] : before.filter(item => item !== permission)
    device.permissionExpiresAt = { ...previousExpiry, [permission]: 0 }
    try { this.persist() } catch (error) { device.permissions = before; device.permissionExpiresAt = previousExpiry; throw error }
    return this.publicRecord(device)
  }

  revoke(id: string): boolean {
    const record = this.devices.find(device => device.id === id && !device.revoked)
    if (!record) return false
    record.revoked = true
    try { this.persist(); return true } catch { record.revoked = false; throw new Error('Cihaz iptali diske kaydedilemedi.') }
  }

  private publicRecord(device: EncryptedDevice): PairedDevice {
    return { id: device.id, name: device.name, pairedAt: device.pairedAt, permissions: [...device.permissions] }
  }

  private read(): EncryptedDevice[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const records = (parsed as { version?: unknown; devices?: unknown }).devices
      if ((parsed as {version?: unknown}).version !== 1 || !Array.isArray(records)) return []
      return records.filter((value): value is EncryptedDevice => Boolean(value && typeof value === 'object' &&
        typeof value.id === 'string' && typeof value.name === 'string' && typeof value.secretEncrypted === 'string' &&
        typeof value.pairedAt === 'number' && typeof value.revoked === 'boolean' && Array.isArray(value.permissions)))
    } catch { return [] }
  }

  private persist(): void {
    const temporary = this.filePath + '.tmp-' + randomUUID()
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, devices: this.devices }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.filePath)
    } finally {
      try { fs.unlinkSync(temporary) } catch { /* already moved */ }
    }
  }
}
