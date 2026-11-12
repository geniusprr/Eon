import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { constantTimeHexEqual, signedRequest, UsbPairingServer } from './UsbPairingServer.js'
import type { DeviceCredentials } from './DeviceCredentials.js'
import { DeckLayoutStore } from '../deck/DeckLayoutStore.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const secret = randomBytes(32).toString('base64url')
const body = Buffer.from('{"value":1}')
const a = signedRequest('POST', '/v1/notes/apply', '1794420000000', 'a'.repeat(32), body, secret)
assert.equal(a.length, 64)
assert.equal(a, signedRequest('POST', '/v1/notes/apply', '1794420000000', 'a'.repeat(32), body, secret))
assert.notEqual(a, signedRequest('POST', '/v1/notes/apply', '1794420000000', 'a'.repeat(32), Buffer.from('{"value":2}'), secret))
assert.notEqual(a, signedRequest('GET', '/v1/notes/apply', '1794420000000', 'a'.repeat(32), body, secret))
assert.equal(constantTimeHexEqual(a, a), true)
assert.equal(constantTimeHexEqual(a, a.slice(0, 62) + '00'), false)
assert.equal(constantTimeHexEqual(a, 'bad'), false)
console.log('Eon 2.0 request signing/forgery tests passed')

test('USB approval binds both directions to one USB tunnel and never issues credentials after rejection', async () => {
  let issued = 0
  const device = { id: 'android-a1', name: 'Test phone', permissions: ['system.read'] }
  const credentials = {
    issue: () => { issued++; return { device, secret } },
    resolve: () => issued ? { device, secret } : null,
    list: () => [],
  } as unknown as DeviceCredentials
  const server = new UsbPairingServer(credentials, { system: () => ({}), notesList: () => [], vaultId: () => 'test-vault' }, 0)
  await server.start()
  try {
    const portA = await server.attachUsb('phone-a')
    const portB = await server.attachUsb('phone-b')
    const phone = { id: device.id, name: device.name, token: randomBytes(32).toString('hex') }
    const endpoint = (port: number, route: string) => `http://127.0.0.1:${port}/v1/usb-approval/${route}`
    const getPrompt = async (port: number) => (await (await fetch(endpoint(port, 'prompt'))).json() as { prompt: { id: string } | null }).prompt
    const approvalResult = async (response: Promise<Response>) => (await (await response).json()) as { state: string; secret?: string }
    const post = (port: number, route: string, extra = {}) => fetch(endpoint(port, route), { method: 'POST', body: JSON.stringify({ ...phone, ...extra }) })
    assert.equal((await fetch(endpoint(server.getLoopbackPort()!, 'prompt'))).status, 403)
    assert.equal((await fetch(endpoint(portA, 'prompt'), { headers: { origin: 'https://example.com' } })).status, 403)
    const first = server.approval.startDesktop('phone-a', 'Phone A')
    assert.equal((await getPrompt(portA))?.id, first.id)
    assert.equal(await getPrompt(portB), null)
    assert.equal((await post(portB, 'decision', { requestId: first.id, accepted: true })).status, 400)
    assert.equal((await approvalResult(post(portA, 'decision', { requestId: first.id, accepted: false }))).state, 'denied')
    assert.equal(server.approval.desktopState(first.id), 'denied')
    assert.equal(issued, 0)

    const second = server.approval.startDesktop('phone-a', 'Phone A')
    assert.equal((await approvalResult(post(portA, 'decision', { requestId: second.id, accepted: true }))).secret, secret)
    assert.equal(server.approval.desktopState(second.id), 'approved')
    assert.equal((await approvalResult(post(portA, 'status'))).secret, secret)
    assert.equal(issued, 1)
    assert.equal((await approvalResult(post(portA, 'status', { token: randomBytes(32).toString('hex') }))).state, 'expired')

    assert.equal((await approvalResult(post(portB, 'request'))).state, 'pending')
    assert.equal(await getPrompt(portB), null)
    const [incoming] = server.approval.desktopPrompts()
    server.approval.decideDesktop(incoming.id, false)
    assert.equal((await approvalResult(post(portB, 'status'))).state, 'denied')
    assert.equal(issued, 1)

    assert.equal((await approvalResult(post(portB, 'request', { token: 'a'.repeat(64) }))).state, 'pending')
    server.approval.decideDesktop(server.approval.desktopPrompts()[0].id, true)
    assert.equal((await approvalResult(post(portB, 'status', { token: 'a'.repeat(64) }))).secret, secret)
    assert.equal(issued, 2)

    const disconnected = server.approval.startDesktop('phone-b', 'Phone B')
    server.detachUsb('phone-b')
    assert.equal(server.approval.desktopState(disconnected.id), 'expired')
  } finally { await server.stop() }
})

test('control routes enforce distinct grants, signed payloads, HTTP methods and revocation', async () => {
  let permissions = ['system.read']
  const dispatched: string[] = []
  const credentials = {
    resolve: () => ({ device: { id: 'android-a1', permissions }, secret }), list: () => [],
  } as unknown as DeviceCredentials
  const server = new UsbPairingServer(credentials, { system: () => ({}), notesList: () => [],
    controls: (pathname, _body, deviceId) => { dispatched.push(`${deviceId}:${pathname}`); return { ok: true } },
  }, 0)
  await server.start()
  try {
    const base = `http://127.0.0.1:${server.getLoopbackPort()}`
    const call = (pathname: string, method = 'POST', tamper = false) => {
      const time = String(Date.now())
      const nonce = randomBytes(16).toString('hex')
      const body = method === 'POST' ? Buffer.from('{"id":"lock"}') : Buffer.alloc(0)
      const signature = signedRequest(method, pathname, time, nonce, body, secret)
      return fetch(base + pathname, { method, headers: { 'x-eon-device': 'android-a1', 'x-eon-time': time,
        'x-eon-nonce': nonce, 'x-eon-signature': signature }, ...(method === 'POST' ? { body: tamper ? '{"id":"shutdown"}' : body } : {}) })
    }
    assert.equal((await call('/v1/files/list', 'GET')).status, 401)
    assert.equal((await call('/v1/deck', 'GET')).status, 200)
    assert.equal((await call('/v1/ai/state', 'GET')).status, 200)
    assert.equal((await call('/v1/ai/models', 'GET')).status, 200)
    assert.equal((await call('/v1/ai/send')).status, 401)
    assert.equal((await call('/v1/ai/approve')).status, 401)
    assert.equal((await call('/v1/ai/pending', 'GET')).status, 401)
    assert.equal((await call('/v1/deck', 'POST')).status, 405)
    assert.equal((await call('/v1/deck/execute')).status, 401)
    permissions = ['files.transfer']
    assert.equal((await call('/v1/files/list', 'GET')).status, 200)
    assert.equal((await call('/v1/files/prepare', 'GET')).status, 405)
    assert.equal((await call('/v1/files/chunk', 'POST', true)).status, 401)
    assert.equal((await call('/v1/files/chunk')).status, 200)
    assert.equal((await call('/v1/actions/execute')).status, 401)
    permissions = ['actions.execute']
    assert.equal((await call('/v1/ai/state', 'GET')).status, 401)
    assert.equal((await call('/v1/ai/send', 'GET')).status, 405)
    assert.equal((await call('/v1/ai/send', 'POST', true)).status, 401)
    assert.equal((await call('/v1/ai/send')).status, 200)
    assert.equal((await call('/v1/ai/approve', 'GET')).status, 405)
    assert.equal((await call('/v1/ai/pending', 'POST')).status, 405)
    assert.equal((await call('/v1/ai/pending', 'GET')).status, 200)
    assert.equal((await call('/v1/ai/approve')).status, 200)
    assert.equal((await call('/v1/ai/reject')).status, 200)
    assert.equal((await call('/v1/actions/execute')).status, 200)
    assert.equal((await call('/v1/deck/execute', 'POST', true)).status, 401)
    assert.equal((await call('/v1/deck/execute')).status, 200)
    assert.equal((await call('/v1/power/execute')).status, 401)
    permissions = ['power.manage']
    assert.equal((await call('/v1/power/execute')).status, 200)
    assert.equal((await call('/v1/deck/execute')).status, 401)
    permissions = []
    assert.equal((await call('/v1/power/execute')).status, 401)
    assert.equal(dispatched.length, 12)
    assert.ok(dispatched.every(item => item.startsWith('android-a1:')))
  } finally { await server.stop() }
})

test('USB HTTP server: explicit physical-code pairing, signed note read and replay/revocation failure', async () => {
  let enabled = true
  let trustedSecret: string | null = null
  const credentials = {
    supportsEncryption: true,
    issue(id: string, name: string) {
      assert.equal(id, 'android-a1')
      trustedSecret = randomBytes(32).toString('base64url')
      return { device: { id, name, pairedAt: Date.now(), permissions:['system.read','notes.read','notes.write'] }, secret: trustedSecret }
    },
    resolve(id: string) {
      if (!enabled || !trustedSecret || id !== 'android-a1') return null
      return { device: { id, name:'test-phone', pairedAt:Date.now(), permissions:['system.read','notes.read','notes.write'] }, secret: trustedSecret }
    },
    list: () => [],
    revoke: () => { enabled = false; return true },
  } as unknown as DeviceCredentials
  const server = new UsbPairingServer(credentials, { system: () => ({ ok: true }), notesList: () => [{ id: 'n-1', title: 'Not' }], vaultId: () => 'vault-test' }, 0)
  await server.start()
  try {
    const base = `http://127.0.0.1:${server.getLoopbackPort()}`
    const hello = await fetch(`${base}/v1/hello`).then(response => response.json()) as { transport:string; pairingAvailable:boolean }
    assert.equal(hello.transport, 'usb')
    assert.equal(hello.pairingAvailable, false)
    assert.equal((await fetch(`${base}/v1/notes/list`)).status, 401)

    const pairing = server.beginPairing()
    const pairedResponse = await fetch(`${base}/v1/pair`, { method:'POST', body:JSON.stringify({ id:'android-a1', name:'test-phone', code:pairing.code }) })
    assert.equal(pairedResponse.status, 200)
    const paired = await pairedResponse.json() as { vaultId:string; secret:string }
    assert.equal(paired.vaultId, 'vault-test')
    assert.equal(paired.secret, trustedSecret)
    const reused = await fetch(`${base}/v1/pair`, { method:'POST', body:JSON.stringify({ id:'android-a1', name:'test-phone', code:pairing.code }) })
    assert.equal(reused.status, 403)

    const now = String(Date.now())
    const nonce = randomBytes(16).toString('hex')
    const payload = Buffer.alloc(0)
    const sig = signedRequest('GET', '/v1/notes/list', now, nonce, payload, paired.secret)
    const headers = { 'x-eon-device':'android-a1', 'x-eon-time':now, 'x-eon-nonce':nonce, 'x-eon-signature':sig }
    const result = await fetch(`${base}/v1/notes/list`, { headers })
    assert.equal(result.status, 200)
    assert.equal((await result.json() as { id:string }[])[0].id, 'n-1')
    assert.equal((await fetch(`${base}/v1/notes/list`, { headers })).status, 401)
    const nextNonce = randomBytes(16).toString('hex')
    const freshHeaders = { ...headers, 'x-eon-nonce': nextNonce, 'x-eon-signature': signedRequest('GET', '/v1/notes/list', now, nextNonce, payload, paired.secret) }
    assert.equal((await fetch(`${base}/v1/notes/list`, { headers:freshHeaders })).status, 200)
    assert.equal(server.revoke('android-a1'), true)
    const revokedNonce = randomBytes(16).toString('hex')
    const revokedHeaders = { ...headers, 'x-eon-nonce':revokedNonce, 'x-eon-signature':signedRequest('GET', '/v1/notes/list', now, revokedNonce, payload, paired.secret) }
    assert.equal((await fetch(`${base}/v1/notes/list`, { headers:revokedHeaders })).status, 401)
  } finally { await server.stop() }
})

test('authenticated Deck layout GET/POST enforces scoped grants, payload cap and HTTP 409 conflict', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-deck-http-'))
  const layout = new DeckLayoutStore(path.join(directory, 'layout.json'))
  let permissions = ['system.read']
  let revoked = false
  const credentials = {
    resolve: (id: string) => id === 'android-a1' && !revoked
      ? { device: { id, permissions }, secret } : null,
  } as unknown as DeviceCredentials
  const server = new UsbPairingServer(credentials, {
    system: () => ({}), notesList: () => [],
    deckLayoutGet: () => layout.get(), deckLayoutSet: payload => layout.set(payload),
  }, 0)
  await server.start()
  try {
    const base = `http://127.0.0.1:${server.getLoopbackPort()}/v1/deck/layout`
    const signed = (method: string, data?: unknown) => {
      const requestBody = data === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data))
      const time = String(Date.now())
      const nonce = randomBytes(16).toString('hex')
      return fetch(base, {
        method, headers: {
          'x-eon-device': 'android-a1', 'x-eon-time': time, 'x-eon-nonce': nonce,
          'x-eon-signature': signedRequest(method, '/v1/deck/layout', time, nonce, requestBody, secret),
        }, ...(method === 'POST' ? { body: requestBody } : {}),
      })
    }
    assert.equal((await fetch(base)).status, 401)
    assert.equal((await signed('PUT')).status, 405)
    const initial = await (await signed('GET')).json() as ReturnType<DeckLayoutStore['get']>
    assert.equal(initial.revision, 0)
    assert.equal((await signed('POST', { baseRevision: 0, widgets: initial.widgets })).status, 401)
    permissions = ['actions.execute']
    assert.equal((await signed('GET')).status, 401)
    const changed = initial.widgets.map(widget => ({ ...widget, visible: widget.id !== 'gpu' }))
    const shortcutIds = ['tool:settings', 'tool:terminal', 'action:existing-command']
    const valid = { baseRevision: 0, widgets: changed, shortcutIds }
    const update = await signed('POST', valid)
    assert.equal(update.status, 200)
    assert.equal((await update.json() as { revision: number }).revision, 1)
    const conflict = await signed('POST', valid)
    assert.equal(conflict.status, 409)
    assert.deepEqual(await conflict.json(), { error: 'deck-layout-conflict', layout: layout.get() })
    assert.equal((await signed('POST', { ...valid, baseRevision: 1, widgets: [] })).status, 400)
    assert.equal((await signed('POST', { ...valid, baseRevision: 1, padding: 'x'.repeat(8 * 1024 * 1024) })).status, 413)
    assert.equal(layout.get().revision, 1)
    permissions = ['system.read']
    const loaded = await signed('GET')
    assert.equal(loaded.status, 200)
    assert.deepEqual((await loaded.json() as ReturnType<DeckLayoutStore['get']>).shortcutIds, shortcutIds)
    revoked = true
    assert.equal((await signed('GET')).status, 401)
    assert.equal((await signed('POST', { baseRevision: 1, widgets: changed })).status, 401)
  } finally {
    await server.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
