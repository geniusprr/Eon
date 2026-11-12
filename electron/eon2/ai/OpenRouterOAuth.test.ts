import assert from 'node:assert/strict'
import test from 'node:test'
import { connectOpenRouter } from './OpenRouterOAuth.js'

test('OpenRouter PKCE only accepts the matching localhost state and exchanges the code once', async () => {
  const testKey = `sk-or-v1-${'a'.repeat(64)}`
  let exchanges = 0
  let observedVerifier = ''
  const connected = await connectOpenRouter(async url => {
    const auth = new URL(url)
    assert.equal(auth.hostname, 'openrouter.ai')
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
    const callback = new URL(auth.searchParams.get('callback_url')!)
    assert.equal(callback.hostname, '127.0.0.1')
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('state', 'wrong-state')
    assert.equal((await fetch(callback)).status, 403)
    callback.searchParams.set('state', auth.searchParams.get('state')!)
    assert.equal((await fetch(callback)).status, 200)
    assert.equal((await fetch(callback)).status, 409)
  }, async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/auth/keys')
    const json = JSON.parse(String(init?.body)) as { code: string; code_verifier: string; code_challenge_method: string }
    observedVerifier = json.code_verifier
    assert.equal(json.code, 'test-code')
    assert.equal(json.code_challenge_method, 'S256')
    exchanges += 1
    return new Response(JSON.stringify({ key: testKey }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  assert.equal(connected, testKey)
  assert.ok(observedVerifier.length >= 32)
  assert.equal(exchanges, 1)
})
