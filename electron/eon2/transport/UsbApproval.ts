import { randomUUID, timingSafeEqual } from 'node:crypto'

const lifetime = 120_000
type Decision = 'pending' | 'approved' | 'denied'
export interface UsbApprovalPrompt { id: string; name: string; direction: 'desktop' | 'phone'; expiresAt: number }
interface Request extends UsbApprovalPrompt { state: Decision; deviceId?: string; token?: string; issued?: boolean }

export class UsbApproval {
  private readonly requests = new Map<string, Request>()

  current(serial: string) {
    const request = this.requests.get(serial)
    if (request && request.expiresAt <= Date.now()) {
      this.requests.delete(serial)
      return undefined
    }
    return request
  }

  startDesktop(serial: string, name: string) {
    const existing = this.current(serial)
    if (existing?.state === 'pending') throw new Error('Bu telefon için zaten bir eşleştirme isteği var.')
    const request = this.start(serial, name, 'desktop')
    return this.publicPrompt(request)
  }

  startPhone(serial: string, name: string, deviceId: string, token: string) {
    const existing = this.current(serial)
    if (existing?.direction === 'phone' && existing.deviceId === deviceId && this.matches(existing, token)) return
    if (existing?.state === 'pending') throw new Error('Bu telefon için zaten bir eşleştirme isteği var.')
    const request = this.start(serial, name, 'phone')
    request.deviceId = deviceId
    request.token = token
  }

  phonePrompt(serial: string) {
    const request = this.current(serial)
    return request?.direction === 'desktop' && request.state === 'pending' ? this.publicPrompt(request) : null
  }

  desktopPrompts() {
    return [...this.requests.keys()].flatMap(serial => {
      const request = this.current(serial)
      return request?.direction === 'phone' && request.state === 'pending' ? [this.publicPrompt(request)] : []
    })
  }

  desktopState(id: string) {
    const serial = [...this.requests.keys()].find(key => this.current(key)?.id === id)
    const request = serial ? this.current(serial) : undefined
    return request?.direction === 'desktop' ? request.state : 'expired'
  }

  decideDesktop(id: string, accepted: boolean) {
    for (const serial of this.requests.keys()) {
      const request = this.current(serial)
      if (request?.id === id && request.direction === 'phone' && request.state === 'pending') {
        request.state = accepted ? 'approved' : 'denied'
        return
      }
    }
    throw new Error('Eşleştirme isteğinin süresi doldu.')
  }

  decidePhone(serial: string, id: string, accepted: boolean, deviceId: string, token: string) {
    const request = this.current(serial)
    if (request?.id !== id || request.direction !== 'desktop') throw new Error('Geçersiz istek.')
    if (request.state !== 'pending') {
      if (request.deviceId === deviceId && this.matches(request, token)) return
      throw new Error('İstek zaten yanıtlandı.')
    }
    request.deviceId = deviceId
    request.token = token
    request.state = accepted ? 'approved' : 'denied'
  }

  status(serial: string, deviceId: string, token: string) {
    const request = this.current(serial)
    if (!request || request.deviceId !== deviceId || !this.matches(request, token)) return 'expired'
    return request.state
  }

  finish(serial: string, deviceId: string, token: string, issue: (issued: boolean) => unknown) {
    const request = this.current(serial)
    if (!request || request.deviceId !== deviceId || !this.matches(request, token) || request.state !== 'approved') return null
    const result = issue(request.issued === true)
    request.issued = true
    return result
  }

  disconnect(serial: string) { this.requests.delete(serial) }

  private start(serial: string, name: string, direction: Request['direction']): Request {
    const request: Request = { id: randomUUID(), name, direction, expiresAt: Date.now() + lifetime, state: 'pending' }
    this.requests.set(serial, request)
    return request
  }

  private matches(request: Request, token: string) {
    return !!request.token && timingSafeEqual(Buffer.from(request.token, 'hex'), Buffer.from(token, 'hex'))
  }

  private publicPrompt({ id, name, direction, expiresAt }: Request): UsbApprovalPrompt { return { id, name, direction, expiresAt } }
}
