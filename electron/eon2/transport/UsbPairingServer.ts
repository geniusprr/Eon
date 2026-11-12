import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import os from 'node:os'
import { DeviceCredentials, type PairedDevice } from './DeviceCredentials.js'
import { UsbApproval } from './UsbApproval.js'
import { DeckLayoutConflictError, MAX_DECK_LAYOUT_BYTES } from '../deck/DeckLayoutStore.js'

export const EON_USB_PORT = 8768
export const EON_TAILNET_PORT = 8769
// Notes manifests can contain 10k+ SHA IDs, and a permitted note can be 5 MiB.
// Limit by encoded bytes, then page deltas below this cap; binary attachments
// will use separate chunk endpoints when that release gate is implemented.
const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const MAX_AI_REQUEST_BYTES = 64 * 1024
const MAX_CLOCK_SKEW_MS = 30_000
const NONCE_RETENTION_MS = 90_000
export type RemotePermission = PairedDevice['permissions'][number]

interface UsbHandlers {
  remoteDesktop?: (operation: string, body: unknown, device: PairedDevice, transport: string, response: ServerResponse) => void
  remoteDisconnected?: (transport: string) => void
  deckLayoutGet?: () => unknown | Promise<unknown>
  deckLayoutSet?: (body: unknown) => unknown | Promise<unknown>
  controls?: (pathname: string, body: unknown, deviceId: string) => unknown | Promise<unknown>
  settings?: (body: unknown, fromUsb: boolean) => unknown | Promise<unknown>
  phoneApprovalRequested?: () => void
  system: () => unknown | Promise<unknown>
  notesList: () => unknown | Promise<unknown>
  vaultId?: () => string
  /** Safe optional sync endpoints are installed once durable journal integration is ready. */
  notesManifest?: () => unknown | Promise<unknown>
  notesDelta?: (body: unknown) => unknown | Promise<unknown>
  notesApply?: (body: unknown) => unknown | Promise<unknown>
}

export interface PairingOffer { code: string; expiresAt: number; }

export function signedRequest(method: string, pathname: string, unixMillis: string, nonce: string, body: Buffer, secret: string): string {
  const hash = createHash('sha256').update(body).digest('hex')
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(`${method}\n${pathname}\n${unixMillis}\n${nonce}\n${hash}`)
    .digest('hex')
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export class UsbPairingServer {
  private readonly server: http.Server
  private readonly usbServers = new Map<string, http.Server>()
  readonly approval = new UsbApproval()
  private tailnetServer: https.Server | null = null
  private tailnetName: string | null = null
  private tailnetIp: string | null = null
  private offer: PairingOffer | null = null
  private attempts = 0
  private readonly nonces = new Map<string, Map<string, number>>()

  constructor(private readonly credentials: DeviceCredentials, private readonly handlers: UsbHandlers, private readonly port = EON_USB_PORT) {
    this.server = http.createServer((req, res) => { void this.route(req, res).catch(() => this.json(res, 500, { error: 'internal-error' })) })
    this.server.requestTimeout = 10_000
    this.server.headersTimeout = 5_000
    this.server.maxHeadersCount = 50
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      // Explicit 127.0.0.1: ADB reverse is the only network entrypoint here.
      this.server.listen(this.port, '127.0.0.1', () => { this.server.off('error', reject); resolve() })
    })
  }

  getLoopbackPort(): number | null {
    const address = this.server.address()
    return address && typeof address === 'object' ? address.port : null
  }

  async stop(): Promise<void> {
    for (const serial of this.usbServers.keys()) this.detachUsb(serial)
    await this.stopTailnet()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  async attachUsb(serial: string): Promise<number> {
    const existing = this.usbServers.get(serial)?.address()
    if (existing && typeof existing === 'object') return existing.port
    const server = http.createServer((req, res) => {
      void this.route(req, res, serial).catch(() => this.json(res, 500, { error: 'internal-error' }))
    })
    server.requestTimeout = 10_000
    server.headersTimeout = 5_000
    server.maxHeadersCount = 50
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    this.usbServers.set(serial, server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('USB portu açılamadı.')
    return address.port
  }

  detachUsb(serial: string) {
    this.handlers.remoteDisconnected?.(`usb:${serial}`)
    const server = this.usbServers.get(serial)
    this.usbServers.delete(serial)
    this.approval.disconnect(serial)
    server?.close()
    server?.closeAllConnections()
  }

  getTailnetListener(): { dnsName: string; ip: string; port: number } | null {
    return this.tailnetServer && this.tailnetName && this.tailnetIp
      ? { dnsName: this.tailnetName, ip: this.tailnetIp, port: EON_TAILNET_PORT }
      : null
  }

  async startTailnet(input: { ip: string; dnsName: string; cert: string; key: string }): Promise<void> {
    const numbers = input.ip.split('.').map(Number)
    if (numbers.length !== 4 || numbers.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
      numbers[0] !== 100 || numbers[1] < 64 || numbers[1] > 127) throw new Error('Geçersiz Tailscale IPv4 adresi.')
    if (!/^[a-z0-9.-]+\.ts\.net$/i.test(input.dnsName) || input.dnsName.includes('..')) throw new Error('Geçersiz Tailscale DNS adı.')
    if (this.tailnetServer) await this.stopTailnet()
    const server = https.createServer({ cert: input.cert, key: input.key, minVersion: 'TLSv1.2',
      honorCipherOrder: true }, (request, response) => { void this.route(request, response).catch(() => this.json(response, 500, { error: 'internal-error' })) })
    server.requestTimeout = 10_000
    server.headersTimeout = 5_000
    server.maxHeadersCount = 50
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(EON_TAILNET_PORT, input.ip, () => { server.off('error', reject); resolve() })
      })
      this.tailnetName = input.dnsName.toLowerCase()
      this.tailnetIp = input.ip
      this.tailnetServer = server
    } catch (error) {
      try { server.close() } catch { /* never opened */ }
      throw error
    }
  }

  async stopTailnet(): Promise<void> {
    this.handlers.remoteDisconnected?.('tailnet')
    const server = this.tailnetServer
    this.tailnetServer = null
    this.tailnetName = null
    this.tailnetIp = null
    if (!server) return
    await new Promise<void>(resolve => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  beginPairing(): PairingOffer {
    if (!this.credentials.supportsEncryption) throw new Error('Windows güvenli anahtar deposu kullanılamıyor.')
    this.offer = { code: randomInt(0, 100_000_000).toString().padStart(8, '0'), expiresAt: Date.now() + 120_000 }
    this.attempts = 0
    return { ...this.offer }
  }

  cancelPairing() { this.offer = null; this.attempts = 0 }

  listDevices(): PairedDevice[] { return this.credentials.list() }

  revoke(id: string): boolean { this.nonces.delete(id); return this.credentials.revoke(id) }

  private async route(request: IncomingMessage, response: ServerResponse, usbSerial?: string): Promise<void> {
    const method = request.method || 'UNKNOWN'
    const host = request.headers.host || ''
    // Reject host header DNS rebinding and external reverse-proxy access.
    const viaTls = Boolean((request.socket as { encrypted?: boolean }).encrypted)
    const hostAllowed = viaTls
      ? this.tailnetName !== null && host.toLowerCase() === `${this.tailnetName}:${EON_TAILNET_PORT}`
      : /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(host)
    if (!hostAllowed) { this.json(response, 403, { error: 'invalid-host' }); return }
    let pathname: string
    try { pathname = new URL(request.url || '/', 'http://localhost').pathname }
    catch { this.json(response, 400, { error: 'invalid-url' }); return }
    if (!pathname.startsWith('/v1/')) { this.json(response, 404, { error: 'not-found' }); return }
    if (pathname.startsWith('/v1/remote-desktop/')) {
      const operation = pathname.slice('/v1/remote-desktop/'.length)
      if (!['status', 'request', 'stream', 'input', 'stop'].includes(operation) || !this.handlers.remoteDesktop) {
        this.json(response, 404, { error: 'not-found' }); return
      }
      if ((!usbSerial && !viaTls) || (usbSerial && !this.usbServers.has(usbSerial)) || request.headers.origin !== undefined) {
        this.json(response, 403, { error: 'transport-unavailable' }); return
      }
      if (method !== (operation === 'status' ? 'GET' : 'POST')) {
        this.json(response, 405, { error: 'method-not-allowed' }); return
      }
      let body: Buffer
      try { body = await this.readBody(request, 8192) }
      catch { this.json(response, 413, { error: 'request-too-large' }); return }
      if (response.destroyed || (usbSerial && !this.usbServers.has(usbSerial)) || (viaTls && !this.tailnetServer)) return
      const device = this.authorize(request, method, pathname, body, null)
      if (!device) { this.json(response, 401, { error: 'unauthorized' }); return }
      try {
        this.handlers.remoteDesktop(operation, body.length ? JSON.parse(body.toString('utf8')) : null,
          device, usbSerial ? `usb:${usbSerial}` : 'tailnet', response)
      } catch {
        this.json(response, 400, { error: 'Geçersiz ekran paylaşımı isteği.' })
      }
      return
    }
    if (pathname.startsWith('/v1/usb-approval/')) {
      if (!usbSerial || !this.usbServers.has(usbSerial) || request.headers.origin !== undefined) {
        this.json(response, 403, { error: 'usb-pairing-only' }); return
      }
      await this.routeApproval(request, response, pathname, usbSerial)
      return
    }
    if (method === 'GET' && pathname === '/v1/hello') {
      this.json(response, 200, { protocol: 1, product: 'eon', device: os.hostname(), transport: viaTls ? 'tailscale' : 'usb',
        tailnetHost: this.tailnetName, pairingAvailable: !viaTls && Boolean(this.offer && this.offer.expiresAt > Date.now()), capabilities: ['system.read', 'notes.read', 'notes.write'] })
      return
    }
    let body: Buffer
    try { body = await this.readBody(request, pathname === '/v1/deck/layout' ? MAX_DECK_LAYOUT_BYTES : pathname.startsWith('/v1/ai/') ? MAX_AI_REQUEST_BYTES : MAX_REQUEST_BYTES) }
    catch (error) {
      this.json(response, error instanceof RequestTooLargeError ? 413 : 400, {
        error: error instanceof RequestTooLargeError ? 'request-too-large' : 'invalid-request-body',
      })
      return
    }
    if (method === 'POST' && pathname === '/v1/pair') {
      // First pairing always requires physical USB approval and the PC-screen code.
      if (viaTls) { this.json(response, 403, { error: 'usb-pairing-only' }); return }
      let payload: { code?: unknown; id?: unknown; name?: unknown }
      try { payload = JSON.parse(body.toString('utf8')) } catch { this.json(response, 400, { error: 'invalid-json' }); return }
      if (!this.offer || this.offer.expiresAt < Date.now() || this.attempts >= 5) { this.json(response, 403, { error: 'pairing-closed' }); return }
      this.attempts++
      if (typeof payload.code !== 'string' || payload.code.length !== 8 || !constantTimeCodeEqual(payload.code, this.offer.code)) { this.json(response, 403, { error: 'invalid-code' }); return }
      if (typeof payload.id !== 'string' || typeof payload.name !== 'string') { this.json(response, 400, { error: 'invalid-device' }); return }
      // Consume exactly once, including when encrypted persistence fails.
      this.offer = null
      try {
        const { device, secret } = this.credentials.issue(payload.id, payload.name)
        this.json(response, 200, { protocol: 1, device, secret,
          vaultId: this.handlers.vaultId?.() ?? null, hostName: os.hostname(), tailnetHost: this.tailnetName })
      } catch { this.json(response, 400, { error: 'invalid-device-or-storage' }) }
      return
    }

    const permission: RemotePermission | null = pathname === '/v1/deck/layout' ? (method === 'POST' ? 'actions.execute' : 'system.read')
      : ['/v1/system', '/v1/settings', '/v1/deck', '/v1/ai/state', '/v1/ai/models'].includes(pathname) ? 'system.read'
      : pathname === '/v1/notes/list' || pathname === '/v1/notes/manifest' || pathname === '/v1/notes/delta' ? 'notes.read'
        : pathname === '/v1/notes/apply' ? 'notes.write'
          : ['/v1/files/list', '/v1/files/prepare', '/v1/files/chunk', '/v1/files/finish', '/v1/files/cancel'].includes(pathname) ? 'files.transfer'
            : ['/v1/actions/list', '/v1/actions/save', '/v1/actions/execute', '/v1/deck/execute', '/v1/ai/send', '/v1/ai/pending', '/v1/ai/approve', '/v1/ai/reject'].includes(pathname) ? 'actions.execute'
              : pathname === '/v1/power/execute' ? 'power.manage' : null
    if (!permission) { this.json(response, 404, { error: 'not-found' }); return }
    const validMethod = pathname === '/v1/settings' || pathname === '/v1/deck/layout' ? method === 'GET' || method === 'POST'
      : ['/v1/notes/apply', '/v1/notes/delta', '/v1/files/prepare', '/v1/files/chunk', '/v1/files/finish', '/v1/files/cancel', '/v1/actions/save', '/v1/actions/execute', '/v1/power/execute', '/v1/deck/execute', '/v1/ai/send', '/v1/ai/approve', '/v1/ai/reject'].includes(pathname) ? method === 'POST' : method === 'GET'
    if (!validMethod) { this.json(response, 405, { error: 'method-not-allowed' }); return }
    if (!this.authorize(request, method, pathname, body, permission)) { this.json(response, 401, { error: 'unauthorized' }); return }

    try {
      if (pathname === '/v1/deck/layout') {
        const operation = method === 'POST' ? this.handlers.deckLayoutSet : this.handlers.deckLayoutGet
        if (!operation) this.json(response, 503, { error: 'capability-not-ready' })
        else this.json(response, 200, await operation(method === 'POST' ? JSON.parse(body.toString('utf8')) : undefined))
      }
      else if ((pathname === '/v1/deck' || pathname === '/v1/deck/execute' || pathname.startsWith('/v1/files/') || pathname.startsWith('/v1/actions/') || pathname.startsWith('/v1/power/') || pathname.startsWith('/v1/ai/')) && this.handlers.controls) {
        this.json(response, 200, await this.handlers.controls(pathname, body.length ? JSON.parse(body.toString('utf8')) : {}, String(request.headers['x-eon-device'])))
      }
      else if (pathname === '/v1/settings' && this.handlers.settings) this.json(response, 200, await this.handlers.settings(method === 'POST' ? JSON.parse(body.toString('utf8')) : undefined, Boolean(usbSerial)))
      else if (pathname === '/v1/system') this.json(response, 200, await this.handlers.system())
      else if (pathname === '/v1/notes/list') this.json(response, 200, await this.handlers.notesList())
      else if (pathname === '/v1/notes/manifest' && this.handlers.notesManifest) this.json(response, 200, await this.handlers.notesManifest())
      else if (pathname === '/v1/notes/delta' && this.handlers.notesDelta) this.json(response, 200, await this.handlers.notesDelta(JSON.parse(body.toString('utf8'))))
      else if (pathname === '/v1/notes/apply' && this.handlers.notesApply) this.json(response, 200, await this.handlers.notesApply(JSON.parse(body.toString('utf8'))))
      else this.json(response, 503, { error: 'capability-not-ready' })
    } catch (error) {
      if (error instanceof DeckLayoutConflictError) {
        this.json(response, 409, { error: 'deck-layout-conflict', layout: error.layout })
      } else this.json(response, 400, { error: 'request-rejected' })
    }
  }

  private async routeApproval(request: IncomingMessage, response: ServerResponse, pathname: string, serial: string) {
    if (pathname === '/v1/usb-approval/prompt' && request.method === 'GET') {
      this.json(response, 200, { prompt: this.approval.phonePrompt(serial), hostName: os.hostname() })
      return
    }
    if (request.method !== 'POST') { this.json(response, 405, { error: 'method-not-allowed' }); return }
    try {
      const payload = JSON.parse((await this.readBody(request, 2048)).toString('utf8')) as Record<string, unknown>
      const { id, name, token, requestId, accepted } = payload
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,90}$/.test(id) ||
          typeof name !== 'string' || !name.trim() || name.length > 80 ||
          typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid-pairing')
      if (!this.usbServers.has(serial)) throw new Error('disconnected')
      if (pathname === '/v1/usb-approval/request') {
        this.approval.startPhone(serial, name.trim(), id, token)
        this.handlers.phoneApprovalRequested?.()
      }
      else if (pathname === '/v1/usb-approval/decision') {
        if (typeof requestId !== 'string' || typeof accepted !== 'boolean') throw new Error('invalid-decision')
        this.approval.decidePhone(serial, requestId, accepted, id, token)
      } else if (pathname !== '/v1/usb-approval/status') { this.json(response, 404, { error: 'not-found' }); return }
      const state = this.approval.status(serial, id, token)
      const credentials = state === 'approved' ? this.approval.finish(serial, id, token, issued =>
        issued ? this.credentials.resolve(id) : this.credentials.issue(id, name)) : null
      this.json(response, 200, credentials ? { ...credentials, state, vaultId: this.handlers.vaultId?.(), hostName: os.hostname(), tailnetHost: this.tailnetName } : { state: state === 'approved' ? 'expired' : state })
    } catch (error) {
      this.json(response, error instanceof RequestTooLargeError ? 413 : 400, { error: 'pairing-rejected' })
    }
  }

  private authorize(request: IncomingMessage, method: string, pathname: string, body: Buffer, permission: RemotePermission | null): PairedDevice | false {
    const id = request.headers['x-eon-device']
    const date = request.headers['x-eon-time']
    const nonce = request.headers['x-eon-nonce']
    const sig = request.headers['x-eon-signature']
    if (typeof id !== 'string' || typeof date !== 'string' || typeof nonce !== 'string' || typeof sig !== 'string') return false
    if (!/^[a-zA-Z0-9_-]{8,90}$/.test(id) || !/^\d{13}$/.test(date) || !/^[a-f0-9]{32}$/i.test(nonce)) return false
    if (Math.abs(Date.now() - Number(date)) > MAX_CLOCK_SKEW_MS) return false
    const verified = this.credentials.resolve(id)
    if (!verified || (permission && !verified.device.permissions.includes(permission))) return false
    if (!constantTimeHexEqual(sig, signedRequest(method, pathname, date, nonce, body, verified.secret))) return false
    const now = Date.now()
    const used = this.nonces.get(id) ?? new Map<string, number>()
    for (const [key, seenAt] of used) {
      if (now - seenAt <= NONCE_RETENTION_MS) break
      used.delete(key)
    }
    if (used.has(nonce)) return false
    if (used.size >= 10000) return false
    used.set(nonce, now)
    this.nonces.set(id, used)
    return verified.device
  }

  private async readBody(request: IncomingMessage, maxBytes = MAX_REQUEST_BYTES): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const value = Buffer.from(chunk)
      size += value.length
      if (size > maxBytes) throw new RequestTooLargeError()
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    if (response.headersSent || response.writableEnded) return
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'connection': 'close',
    })
    response.end(JSON.stringify(value))
  }
}

function constantTimeCodeEqual(given: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))
}

class RequestTooLargeError extends Error {}
