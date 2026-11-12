// Run after npm run build:electron:
// node_modules/.bin/electron electron/eon2/remote/PcRemoteDesktop.electron-smoke.cjs
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const path = require('node:path')
const { app, BrowserWindow, dialog, powerMonitor, screen } = require('electron')

app.whenReady().then(async () => {
  const root = '../../../dist-electron/electron'
  const { PcRemoteDesktop } = await import(`${root}/eon2/remote/PcRemoteDesktop.js`)
  const { UsbPairingServer, signedRequest } = await import(`${root}/eon2/transport/UsbPairingServer.js`)
  const { WindowsInputInjector } = await import(`${root}/WindowsInputInjector.js`)
  const secret = randomBytes(32).toString('base64url')
  const device = { id: 'pc-screen-smoke', name: 'Test phone', pairedAt: Date.now(), permissions: [] }
  const window = new BrowserWindow({ show: false })
  const preload = path.resolve(__dirname, root, 'eon2/remote/pc-capture-preload.cjs')
  const remote = new PcRemoteDesktop(preload, window, new WindowsInputInjector(), () => {}, () => true)
  const server = new UsbPairingServer({ resolve: id => id === device.id ? { device, secret } : null }, {
    system: () => ({}), notesList: () => ({}),
    remoteDesktop: (...args) => remote.route(...args),
    remoteDisconnected: transport => remote.disconnect(transport),
  }, 0)
  const original = dialog.showMessageBox
  let approve
  dialog.showMessageBox = () => new Promise(resolve => { approve = resolve })
  try {
    await server.start()
    const usbPort = await server.attachUsb('test-usb')
    const otherUsb = await server.attachUsb('other-usb')
    const options = (operation, payload) => {
      const pathname = '/v1/remote-desktop/' + operation
      const method = payload ? 'POST' : 'GET'
      const body = payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0)
      const now = String(Date.now())
      const nonce = randomBytes(16).toString('hex')
      return { pathname, request: { method, body: payload ? body : undefined, signal: AbortSignal.timeout(14_000), headers: {
        'X-Eon-Device': device.id, 'X-Eon-Time': now, 'X-Eon-Nonce': nonce,
        'X-Eon-Signature': signedRequest(method, pathname, now, nonce, body, secret),
      } } }
    }
    const call = (operation, payload, port = usbPort) => {
      const { pathname, request } = options(operation, payload)
      return fetch(`http://127.0.0.1:${port}${pathname}`, request)
    }
    assert.equal((await call('status', undefined, server.getLoopbackPort())).status, 403)
    assert.equal((await fetch(`http://127.0.0.1:${usbPort}/v1/remote-desktop/status`)).status, 401)
    const replay = options('status')
    const url = `http://127.0.0.1:${usbPort}${replay.pathname}`
    assert.equal((await fetch(url, replay.request)).status, 200)
    assert.equal((await fetch(url, replay.request)).status, 401)
    const id = randomUUID()
    const avc = process.env.EON_TEST_PC_AVC === '1'
    const quality = process.env.EON_TEST_PC_QUALITY || 'low'
    const display = screen.getPrimaryDisplay()
    assert.equal((await call('request', { id, display: display.id, quality, control: true, avc })).status, 200)
    assert.equal((await call('stream', { id })).status, 409)
    approve({ response: 2 })
    await delay(50)
    assert.equal((await call('stream', { id }, otherUsb)).status, 409)
    const heartbeat = setInterval(() => { void call('status').catch(() => {}) }, 650)
    try {
      const startedAt = performance.now()
      const stream = await call('stream', { id })
      assert.equal(stream.status, 200, stream.status === 200 ? undefined : await stream.text())
      assert.equal(stream.headers.get('x-eon-control'), '1')
      assert.equal(stream.headers.get('content-type'), `application/vnd.eon.remote-${avc ? 'avc' : 'vp8'}`)
      const reader = stream.body.getReader()
      let buffer = Buffer.alloc(0)
      const packet = async () => {
        while (buffer.length < 5 || buffer.length < 5 + buffer.readUInt32BE(0)) {
          const result = await reader.read()
          assert.equal(result.done, false)
          buffer = Buffer.concat([buffer, result.value])
        }
        const end = 5 + buffer.readUInt32BE(0)
        const value = { kind: buffer[4], bytes: buffer.subarray(5, end) }
        buffer = buffer.subarray(end)
        return value
      }
      const first = await packet()
      assert.equal(first.kind, 1)
      if (avc) {
        const nals = [...first.bytes.toString('latin1').matchAll(/\x00\x00\x01(.)/gs)].map(match => match[1].charCodeAt(0) & 0x1f)
        for (const type of [5, 7, 8]) assert.ok(nals.includes(type), `Missing AVC NAL type ${type}`)
      } else {
        assert.deepEqual([...first.bytes.subarray(3, 6)], [0x9d, 1, 0x2a])
      }
      console.log(`First keyframe arrived in ${Math.round(performance.now() - startedAt)} ms.`)
      assert.equal((await call('input', { id, sequence: 0, events: [{ type: 'release' }] })).status, 200)
      assert.equal((await call('input', { id, sequence: 0, events: [{ type: 'release' }] })).status, 400)
      assert.equal((await call('input', { id, sequence: 1, events: [{ type: 'shell', command: 'unused' }] })).status, 400)
      const indicator = BrowserWindow.getAllWindows().find(item => item.getTitle() === 'Eon · PC ekran paylaşımı')
      assert.ok(indicator?.isVisible() && indicator.isAlwaysOnTop())
      await indicator.webContents.executeJavaScript('document.body.style.background = "#135964"')
      let message
      do { message = await packet() } while (message.kind !== 1 && message.kind !== 2)
      assert.ok(message.bytes.length > 0)
      await indicator.webContents.executeJavaScript('document.querySelector("a").click()')
      do { message = await packet() } while (message.kind !== 3)
      assert.equal((await call('input', { id, sequence: 2, events: [{ type: 'release' }] })).status, 409)
      powerMonitor.emit('lock-screen')
      do { message = await packet() } while (message.kind !== 4)
      assert.match(message.bytes.toString(), /kilitlendi/)
      assert.equal((await reader.read()).done, true)
      assert.equal(indicator.isDestroyed(), true)
      console.log(`PC screen smoke passed: ${stream.headers.get('x-eon-width')}×${stream.headers.get('x-eon-height')} ${avc ? 'H.264' : 'VP8'} at ${display.scaleFactor * 100}% Windows scaling; signed USB, consent, replay, tunnel binding, control revoke and lock teardown.`)
    } finally { clearInterval(heartbeat) }
  } finally {
    dialog.showMessageBox = original
    remote.dispose()
    await server.stop()
    window.destroy()
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
