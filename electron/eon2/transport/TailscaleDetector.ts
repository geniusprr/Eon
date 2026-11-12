import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const FALLBACK_EXE = 'C:\\Program Files\\Tailscale\\tailscale.exe'
const MAX_OUTPUT = 1024 * 1024

export interface TailnetStatus {
  installed: boolean
  running: boolean
  online: boolean
  dnsName: string | null
  ipv4: string | null
}

function validTailnetIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false
  const parts = value.split('.').map(Number)
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

function validTailnetDns(value: string): boolean {
  return value.length <= 253 && /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.ts\.net$/i.test(value) && !value.includes('..')
}

export function parseTailscaleStatus(payload: unknown): TailnetStatus {
  const empty = { installed: true, running: false, online: false, dnsName: null, ipv4: null }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty
  const source = payload as Record<string, unknown>
  const online = source.BackendState === 'Running' && source.Self && typeof source.Self === 'object' && (source.Self as Record<string, unknown>).Online === true
  const self = source.Self && typeof source.Self === 'object' ? source.Self as Record<string, unknown> : {}
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : []
  const ip = ips.find(item => typeof item === 'string' && validTailnetIPv4(item))
  const name = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : ''
  return {
    installed: true,
    running: source.BackendState === 'Running',
    online: Boolean(online && ip && validTailnetDns(name)),
    dnsName: validTailnetDns(name) ? name : null,
    ipv4: typeof ip === 'string' ? ip : null,
  }
}

export class TailscaleDetector {
  private readonly exe: string
  constructor(binary = process.platform === 'win32' ? FALLBACK_EXE : 'tailscale') {
    this.exe = binary
  }

  async getStatus(): Promise<TailnetStatus> {
    try {
      const { stdout } = await execFileAsync(this.exe, ['status', '--json'], {
        timeout: 4000, windowsHide: true, maxBuffer: MAX_OUTPUT,
      })
      return parseTailscaleStatus(JSON.parse(stdout))
    } catch {
      return { installed: false, running: false, online: false, dnsName: null, ipv4: null }
    }
  }

  /** Private certificate material is never logged or persisted by Eon. */
  async getHttpsCertificate(dnsName: string): Promise<{ cert: string; key: string }> {
    if (!validTailnetDns(dnsName)) throw new Error('Geçersiz Tailscale DNS kimliği.')
    const { stdout } = await execFileAsync(this.exe, ['cert', '--cert-file', '-', '--key-file', '-', dnsName], {
      timeout: 8000, windowsHide: true, maxBuffer: MAX_OUTPUT,
    })
    const certs = stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []
    const keys = stdout.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g) || []
    if (!certs.length || keys.length !== 1) throw new Error('Geçerli Tailscale HTTPS sertifikası üretilemedi.')
    return { cert: certs.join('\n'), key: keys[0] }
  }
}
