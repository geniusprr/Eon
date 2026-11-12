import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'

const AUTH_URL = 'https://openrouter.ai/auth'
const KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'
const CALLBACK_PATH = '/eon-openrouter-callback'
const LOGIN_TIMEOUT_MS = 180_000

let loginInProgress = false

/** Uses OpenRouter's official OAuth PKCE flow without exposing the resulting key to the renderer. */
export async function connectOpenRouter(
  openExternal: (url: string) => Promise<unknown>,
  exchangeFetch: typeof fetch = fetch,
): Promise<string> {
  if (loginInProgress) throw new Error('OpenRouter bağlantı penceresi zaten açık.')
  loginInProgress = true
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  let complete: ((code: string) => void) | null = null
  let fail: ((error: Error) => void) | null = null
  let fulfilled = false
  const callback = new Promise<string>((resolve, reject) => { complete = resolve; fail = reject })
  const server = http.createServer((req, res) => {
    const port = (server.address() as { port: number } | null)?.port
    if (req.method !== 'GET' || !port || req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403).end('Access denied')
      return
    }
    let target: URL
    try { target = new URL(req.url || '/', `http://127.0.0.1:${port}`) }
    catch { res.writeHead(400).end('Invalid callback'); return }
    if (target.pathname !== CALLBACK_PATH) { res.writeHead(404).end('Not found'); return }
    if (target.searchParams.get('state') !== state) {
      res.writeHead(403).end('Invalid authorization state')
      return
    }
    if (fulfilled) { res.writeHead(409).end('Authorization already used'); return }
    const code = target.searchParams.get('code')
    if (!code || code.length > 2048 || /[^\x21-\x7e]/.test(code)) {
      res.writeHead(400).end('Missing authorization code')
      return
    }
    fulfilled = true
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end('OpenRouter authorization received. Return to Eon to finish connecting.')
    complete?.(code)
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Yerel bağlantı noktası açılamadı.')
    const callbackUrl = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    const authorization = new URL(AUTH_URL)
    authorization.searchParams.set('callback_url', callbackUrl)
    authorization.searchParams.set('code_challenge', challenge)
    authorization.searchParams.set('code_challenge_method', 'S256')
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('key_label', 'Eon Desktop')

    timeout = setTimeout(() => fail?.(new Error('OpenRouter oturum açma süresi doldu. Tekrar dene.')), LOGIN_TIMEOUT_MS)
    await openExternal(authorization.toString())
    const code = await callback
    const response = await exchangeFetch(KEY_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`OpenRouter doğrulaması reddedildi (HTTP ${response.status}).`)
    const result: unknown = await response.json()
    const key = result && typeof result === 'object' && 'key' in result ? result.key : null
    if (typeof key !== 'string' || !/^sk-or-[A-Za-z0-9_-]{12,512}$/.test(key)) {
      throw new Error('OpenRouter geçerli bir erişim anahtarı döndürmedi.')
    }
    return key
  } finally {
    if (timeout) clearTimeout(timeout)
    server.closeAllConnections()
    await new Promise<void>(resolve => { if (!server.listening) resolve(); else server.close(() => resolve()) })
    loginInProgress = false
  }
}
