const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// End-to-end scrcpy smoke against a user-authorised USB Android device.
// No Android input, power actions, pairing or files are transferred.
// Run: node_modules/electron/dist/electron.exe electron/eon2/phone-smoke.cjs
let runtime
let profile
const output = path.resolve('docs/eon2/qa-phone')
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function until(callback, label, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const result = await callback()
      if (result) return result
      last = result
    } catch (cause) { last = cause.message }
    await sleep(300)
  }
  throw new Error(`Zaman aşımı: ${label}. Son durum: ${JSON.stringify(last)}`)
}

async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-phone-smoke-'))
  app.setPath('userData', profile)
  await app.whenReady()
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item.webContents.getURL().includes('/index.html')) || BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
  assert.ok(win, 'Eon main window missing')
  if (win.isMaximized()) win.unmaximize()
  win.setContentSize(1440, 900)
  win.show()
  win.focus()
  await until(() => win.webContents.getURL().includes('/index.html') && !win.webContents.isLoading(), 'Eon renderer loaded')
  const js = code => win.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.kapanisDesktop && document.querySelector(\'.eon-studio-tile--phone .eon2-phone-viewport, .eon-deck-phone .eon2-phone-viewport\'))'), 'Eon phone interface loaded')
  await js("document.querySelector('[aria-label=\"Rehberi kapat\"]')?.click()")
  const connected = await js("window.kapanisDesktop.invoke('eon2:devices')")
  const eligible = connected.devices.filter(device => device.usb && device.state === 'device')
  const requestedSerial = process.env.EON_SMOKE_USB_SERIAL
  const chosen = requestedSerial ? eligible.find(device => device.serial === requestedSerial) : eligible.length === 1 ? eligible[0] : null
  assert.ok(chosen, 'Connect exactly one authorised USB Android device, or set EON_SMOKE_USB_SERIAL')
  const serial = chosen.serial
  await until(() => js(`(() => {
    const select = document.querySelector('.eon-studio-tile--phone .eon2-phone-picker select, .eon-deck-phone .eon2-phone-picker select')
    return select && [...select.options].some(item => item.value === ${JSON.stringify(serial)})
  })()`), `USB device ${serial} in UI`)
  await js(`(() => {
    const root = document.querySelector('.eon-studio-tile--phone, .eon-deck-phone')
    const select = root?.querySelector('.eon2-phone-picker select')
    select.value = ${JSON.stringify(serial)}
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const button = [...root.querySelectorAll('button')].find(item => item.textContent.includes('Ekranı aç'))
    if (!button || button.disabled) throw new Error('Ekranı aç düğmesi etkin değil')
    button.click()
  })()`)
  const status = () => js("window.kapanisDesktop.invoke('eon2:scrcpy:status')")
  const initial = await until(async () => {
    const next = await status()
    if (next.state === 'error') throw new Error(next.message)
    return next.state === 'running' && next
  }, 'embedded scrcpy running', 22000)
  assert.equal(initial.serial, serial)
  assert.equal(initial.mode, 'embedded')
  const slot = await until(() => js(`(() => {
    const preview = document.querySelector('.eon-studio-tile--phone .eon2-phone-viewport, .eon-deck-phone .eon2-phone-viewport')
    if (!preview) return null
    const rect = preview.getBoundingClientRect()
    const visibleWidth = Math.min(innerWidth,rect.right) - Math.max(0,rect.left)
    const visibleHeight = Math.min(innerHeight,rect.bottom) - Math.max(0,rect.top)
    return visibleWidth >= 48 && visibleHeight >= 48 ?
      { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })()`), 'visible native video slot')
  await sleep(950)
  assert.equal((await status()).state, 'running', 'Native presentation must remain running')

  const clickMode = async (mode, expected) => {
    await js(`(() => {
      const button = document.querySelector(${JSON.stringify(`.eon-studio-tile--phone .eon2-phone-mode-switch button[title="${mode}"], .eon-deck-phone .eon2-phone-mode-switch button[title="${mode}"]`)})
      if (!button || button.disabled) throw new Error('Mod düğmesi kullanılamıyor: ' + ${JSON.stringify(mode)})
      button.click()
    })()`)
    return until(async () => {
      const next = await status()
      if (next.state === 'error') throw new Error(next.message)
      return next.state === 'running' && next.mode === expected && next
    }, `${mode} mode`)
  }
  await clickMode('PiP', 'pip')
  const floating = await until(() => BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item !== win), 'PiP BrowserWindow')
  assert.equal(floating.isAlwaysOnTop(), true)
  await clickMode('Pencere', 'window')
  assert.equal(floating.isAlwaysOnTop(), false)
  await clickMode('Eon içinde', 'embedded')
  await sleep(650)
  assert.equal((await status()).state, 'running')
  assert.equal(floating.isDestroyed(), true)
  // Recreate the renderer surface while the same scrcpy process keeps running.
  await js("document.querySelector('.eon2-nav-item[title=\"Cihazlar\"]')?.click()")
  await until(() => js("Boolean(document.querySelector('.eon2-phone-surface:not(.is-compact) .eon2-phone-viewport'))"), 'Devices screen live surface')
  assert.equal((await status()).state, 'running')
  await js("document.querySelector('.eon2-nav-item[title=\"Dashboard\"]')?.click()")
  await until(() => js("Boolean(document.querySelector('.eon-studio-tile--phone .eon2-phone-viewport'))"), 'Dashboard live surface after navigation')
  const responsive = []
  for (const [width, height] of [[720, 900], [900, 720], [1440, 900]]) {
    if (win.isMaximized()) win.unmaximize()
    win.setContentSize(width, height)
    await sleep(650)
    const measured = await js(`(() => {
      const video = document.querySelector('.eon-studio-tile--phone .eon2-phone-viewport')
      if (!video) return null
      const box = video.getBoundingClientRect()
      return { viewportWidth:innerWidth, viewportHeight:innerHeight, videoWidth:box.width, videoHeight:box.height, top:box.top, left:box.left, visibleWidth:Math.min(innerWidth,box.right)-Math.max(0,box.left), visibleHeight:Math.min(innerHeight,box.bottom)-Math.max(0,box.top) }
    })()`)
    assert.ok(measured && Math.abs(measured.viewportWidth - width) <= 30 && Math.abs(measured.viewportHeight - height) <= 30, `Viewport not resized to ${width}x${height}: ${JSON.stringify({ measured, actual:win.getContentSize(), maximized:win.isMaximized(), bounds:win.getBounds() })}`)
    assert.ok(measured && measured.visibleWidth >= 48 && measured.visibleHeight >= 48, `Embedded video clipped at ${width}x${height}`)
    assert.equal((await status()).state, 'running', `Scrcpy lost during ${width}x${height} resize`)
    responsive.push(measured)
  }
  await js(`(() => {
    const root = document.querySelector('.eon-studio-tile--phone, .eon-deck-phone')
    const button = [...root.querySelectorAll('button')].find(item => item.textContent.includes('Oturumu bitir'))
    if (!button || button.disabled) throw new Error('Oturumu bitir düğmesi kullanılamıyor')
    button.click()
  })()`)
  await until(async () => (await status()).state === 'idle', 'stop scrcpy')
  await js("document.querySelector('.eon2-nav-item[title=\"Eon Notes\"], .eon-deck-navigation button[title=\"Notları aç\"]')?.click()")
  await sleep(250)
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, deviceModel: chosen.model || 'Android', modes: ['embedded','pip','window','embedded'], nativeSlot: slot, responsive, remount: true, startup: { state:initial.state, mode:initial.mode }, stopped: true, testedAt: new Date().toISOString() }, null, 2))
  console.log('Eon physical Android phone screen smoke passed', JSON.stringify({ deviceModel:chosen.model || 'Android', slot, responsive, remount:true, modes: ['embedded','pip','window','embedded'] }))
}

void main().then(() => { runtime?.close(); app.exit(0) }).catch(async error => {
  console.error(error)
  try { await runtime?.close() } catch { /* test must end */ }
  app.exit(1)
})
setTimeout(() => { console.error('Eon phone smoke timed out'); runtime?.close(); app.exit(1) }, 60000).unref()
