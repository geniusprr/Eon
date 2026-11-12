const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

// Run with node_modules/electron/dist/electron.exe electron/eon2/controls-smoke.cjs.
// This profile is isolated; this test never executes a power or shell action.
process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let profile
const output = path.resolve('docs/eon2/qa-workspace')
;(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-controls-smoke-'))
  app.setPath('userData', profile)
  await app.whenReady()
  if (process.platform === 'win32') app.setAppUserModelId('com.kapanis.desktop.smoke')
  await fs.mkdir(output, { recursive: true })
  const { DeviceCredentials } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/transport/DeviceCredentials.js')).href)
  const credentials = new DeviceCredentials(path.join(profile, 'credential-test'))
  credentials.issue('smoke-device-1', 'Smoke phone')
  assert.equal(credentials.resolve('smoke-device-1').device.permissions.includes('files.transfer'), true)
  credentials.setPermission('smoke-device-1', 'files.transfer', true)
  assert.equal(credentials.resolve('smoke-device-1').device.permissions.includes('files.transfer'), true)
  const now = Date.now
  const future = now() + 3600_001
  try {
    Date.now = () => future
    assert.equal(credentials.resolve('smoke-device-1').device.permissions.includes('files.transfer'), true)
  } finally { Date.now = now }
  credentials.revoke('smoke-device-1')
  assert.equal(credentials.resolve('smoke-device-1'), null)
  const runtimeCredentials = new DeviceCredentials(path.join(profile, 'eon-2'))
  runtimeCredentials.issue('smoke-file-target', 'Smoke file receiver')
  runtimeCredentials.setPermission('smoke-file-target', 'files.transfer', true)
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('[renderer]', message) })
  if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  const js = code => window.webContents.executeJavaScript(code)
  const settle = () => new Promise(resolve => setTimeout(resolve, 350))
  const waitFor = async (expression, label, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await js(expression)) return
      await settle()
    }
    throw new Error(`UI not ready: ${label}`)
  }
  const select = title => js(`[...document.querySelectorAll('.eon2-nav-item')].find(button => button.title === ${JSON.stringify(title)}).click()`)
  await settle()
  await js("document.querySelector('[aria-label=\"Rehberi kapat\"]')?.click()")
  await settle()
  assert.equal(await js('!!window.kapanisDesktop'), true)
  assert.equal(await js("window.kapanisDesktop.invoke('eon2:theme:set', 'dark')"), true)
  assert.equal(await js("window.kapanisDesktop.invoke('eon2:theme:set', 'invalid').then(()=>false,()=>true)"), true)
  const controls = await js("window.kapanisDesktop.invoke('eon2:actions:list')")
  assert.equal(controls.actions.length, 4)
  assert.ok(controls.actions.every(action => action.remoteEnabled === true), 'Fresh built-in shortcuts should allow execution from the phone by default')
  const action = await js("window.kapanisDesktop.invoke('eon2:actions:save', {name:'Smoke test',kind:'command',target:'Write-Output smoke',arguments:[],delaySeconds:0,remoteEnabled:false})")
  assert.ok(action.id)
  await js(`window.kapanisDesktop.invoke('eon2:actions:delete', {id:${JSON.stringify(action.id)}})`)
  assert.equal(await js("window.kapanisDesktop.invoke('launch-program', {}).then(()=>false,()=>true)"), true)
  const preferences = await js("window.kapanisDesktop.invoke('eon2:settings:get')")
  assert.equal(typeof preferences.autostart, 'boolean')
  assert.equal(typeof preferences.tailscale, 'boolean')
  if (process.platform === 'win32') {
    try {
      assert.equal(await js("window.kapanisDesktop.invoke('eon2:settings:set', {key:'autostart',value:true}).then(result=>result.autostart)"), true)
    } finally {
      assert.equal(await js("window.kapanisDesktop.invoke('eon2:settings:set', {key:'autostart',value:false}).then(result=>result.autostart)"), false)
    }
  }
  assert.equal(await js("window.kapanisDesktop.invoke('eon2:settings:set', {key:'theme',value:'violet'}).then(result=>result.theme)"), 'violet')
  await js("window.kapanisDesktop.invoke('eon2:settings:set', {key:'theme',value:'obsidian'})")
  assert.equal(await js("!!document.querySelector('.eon-studio')"), true)
  assert.equal(await js("!!document.querySelector('.eon-studio-tile--phone .eon2-phone-viewport')"), true)
  assert.equal(await js("!!document.querySelector('.eon2-nav-item[title=\"Cihazlar\"] svg.lucide-smartphone')"), true)
  assert.equal(await js("!!document.querySelector('.eon2-title-brand svg path')"), true)
  assert.match(await js("getComputedStyle(document.querySelector('.eon2-title-brand')).fontFamily"), /Bricolage Grotesque Variable/)
  assert.equal(await js(`(() => {
    const bar = document.querySelector('.eon2-topbar').getBoundingClientRect()
    const logo = document.querySelector('.eon2-title-brand svg').getBoundingClientRect()
    return Math.abs(bar.top + bar.height/2 - logo.top - logo.height/2) < 1
  })()`), true)
  assert.equal(await js("!!document.querySelector('.eon2-topbar-date, .eon2-topbar-local, .eon2-topbar-avatar, .eon2-home-clock')"), false)
  assert.equal(await js("document.querySelector('.eon-studio-heading h1')?.textContent?.includes('Çalışma alanın')"), true)
  const results = []
  for (const [width, height] of [[720, 900], [900, 720], [1440, 900], [3840, 2160]]) {
    window.setContentSize(width, height)
    await settle()
    const dimensions = await js('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})')
    assert.equal(dimensions.overflow, false)
    await fs.writeFile(path.join(output, `dashboard-${width}.png`), (await window.webContents.capturePage()).toPNG())
    results.push(dimensions)
  }
  window.setContentSize(1440, 900)
  await settle()
  assert.equal(await js(`(() => {
    const phone = document.querySelector('.eon-studio-tile--phone').getBoundingClientRect()
    const canvas = document.querySelector('.eon-studio-canvas').getBoundingClientRect()
    return phone.width >= 240 && phone.height > 300 && phone.top >= canvas.top
  })()`), true)
  await js("document.querySelector('.eon-studio-edit').click()")
  await settle()
  assert.equal(await js("document.querySelector('.eon-studio-edit').getAttribute('aria-pressed')"), 'true')
  assert.equal(await js("!!document.querySelector('.eon-studio-tile--phone .eon-studio-handle')"), true)
  await js("document.querySelector('.eon-studio-edit').click()")
  await settle()
  assert.equal(await js("document.querySelector('.eon-studio-edit').getAttribute('aria-pressed')"), 'false')
  assert.equal(await js("!!document.querySelector('.eon-studio-tile--phone .eon2-phone-surface')"), true)
  window.webContents.reload()
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  await settle()
  assert.equal(await js("!!document.querySelector('.eon-studio-tile--phone .eon2-phone-surface')"), true)
  await fs.writeFile(path.join(output, 'studio-reopened.png'), (await window.webContents.capturePage()).toPNG())
  await select('Cihazlar')
  await settle()
  assert.equal(await js("!!document.querySelector('.eon2-phone-surface:not(.is-compact) .eon2-phone-viewport')"), true)
  assert.equal(await js("document.querySelector('.eon2-phone-surface:not(.is-compact) select')?.labels.length"), 1)
  assert.equal(await js("document.querySelectorAll('.eon2-phone-mode-switch button[aria-pressed]').length"), 3)
  await fs.writeFile(path.join(output, 'devices-1440.png'), (await window.webContents.capturePage()).toPNG())
  window.setContentSize(720, 900)
  await settle()
  assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true)
  await fs.writeFile(path.join(output, 'devices-720.png'), (await window.webContents.capturePage()).toPNG())
  window.setContentSize(1440, 900)
  await select('PC Kısayolları')
  await settle()
  assert.equal(await js("document.querySelector('h1').textContent"), 'Kısayollar ve güç')
  await fs.writeFile(path.join(output, 'shortcuts.png'), (await window.webContents.capturePage()).toPNG())
  await js("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Kısayol ekle')).click()")
  await settle()
  assert.equal(await js("document.querySelector('dialog')?.open && !!document.querySelector('dialog input[required]')"), true)
  assert.equal(await js("document.querySelector('dialog .eon2-checkbox input[type=checkbox]')?.checked"), true)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await settle()
  assert.equal(await js("!document.querySelector('dialog')"), true)
  await select('Dosya Aktarımı')
  await settle()
  assert.equal(await js("document.querySelector('h1').textContent"), 'Dosya aktarımı')
  await fs.writeFile(path.join(output, 'transfers.png'), (await window.webContents.capturePage()).toPNG())
  await select('Ayarlar')
  await settle()
  await js("[...document.querySelectorAll('.eon2-theme-swatch')].find(button=>button.textContent.includes('Aydınlık')).click()")
  await waitFor("document.querySelector('.eon2-app').classList.contains('eon2-theme-light')", 'light theme')
  assert.equal(await js("document.querySelector('.eon2-app').classList.contains('eon2-theme-light')"), true)
  await fs.writeFile(path.join(output, 'settings-light.png'), (await window.webContents.capturePage()).toPNG())
  // Animation-frame measurements require a foreground window on Windows.
  window.show()
  window.focus()
  await settle()
  await select('Dashboard')
  await settle()
  assert.equal(await js("getComputedStyle(document.querySelector('.eon2-title-brand svg')).filter"), 'invert(1)')
  await fs.writeFile(path.join(output, 'board-light.png'), (await window.webContents.capturePage()).toPNG())
  const responseTimes = await js(`(async () => {
    const times = [];
    for (let index = 0; index < 30; index++) {
      const title = index % 2 ? 'Dashboard' : 'PC Kısayolları';
      const start = performance.now();
      [...document.querySelectorAll('.eon2-nav-item')].find(button => button.title === title).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      times.push(performance.now() - start);
    }
    return times.sort((a,b) => a-b);
  })()`)
  const droppedFile = path.join(profile, 'drag-demo.txt')
  await fs.writeFile(droppedFile, 'Eon native file drop smoke')
  const debuggerClient = window.webContents.debugger
  debuggerClient.attach('1.3')
  try {
    const data = { items: [], files: [droppedFile], dragOperationsMask: 1 }
    for (const [target, label] of [['automations', 'Kısayol'], ['transfers', 'LocalSend']]) {
      await debuggerClient.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', x: 300, y: 250, data })
      await debuggerClient.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', x: 300, y: 250, data })
      const point = await js(`(() => {
        const element = document.querySelector('[data-file-destination="${target}"]')
        if (!element || !element.innerText.includes(${JSON.stringify(label)})) return null
        const {x,y,width,height} = element.getBoundingClientRect()
        return {x: Math.round(x + width / 2), y: Math.round(y + height / 2)}
      })()`)
      assert.ok(point, `File drag did not reveal ${label}`)
      await debuggerClient.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...point, data })
      if (target === 'transfers') {
        await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        await fs.writeFile(path.join(output, 'file-drop.png'), (await window.webContents.capturePage()).toPNG())
      }
      await debuggerClient.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...point, data })
      await settle()
      if (target === 'automations') {
        assert.equal(await js("document.querySelector('.eon2-control-editor input')?.value"), 'drag-demo')
        assert.equal(await js("document.querySelector('.eon2-control-editor select')?.value"), 'file')
        await js("document.querySelector('.eon2-control-editor [aria-label=\"Düzenleyiciyi kapat\"]').click()")
      } else {
        assert.equal(await js("document.querySelector('.eon2-drop-selection li')?.innerText"), 'drag-demo.txt')
        await js("[...document.querySelectorAll('.eon2-transfer-drop button')].find(button => button.textContent.includes('Gönder')).click()")
        await settle()
        const queue = await js("window.kapanisDesktop.invoke('eon2:files:list')")
        assert.equal(queue.find(file => file.fileName === 'drag-demo.txt')?.deviceId, 'smoke-file-target')
      }
    }
  } finally { debuggerClient.detach() }
  const usbSerial = process.env.EON_SMOKE_USB_SERIAL
  if (usbSerial) {
    assert.match(usbSerial, /^[A-Za-z0-9._-]{1,160}$/)
    const callAdb = (...args) => promisify(execFile)('adb', ['-s', usbSerial, ...args], { timeout: 10000, windowsHide: true })
    const offer = await js(`window.kapanisDesktop.invoke('eon2:pairing:begin', {serial:${JSON.stringify(usbSerial)}})`)
    const uiPath = '/data/local/tmp/eon-pairing-smoke.xml'
    try {
      let reject
      for (let attempt = 0; attempt < 3 && !reject; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1300))
        await callAdb('shell', 'uiautomator', 'dump', uiPath)
        const { stdout } = await callAdb('shell', 'cat', uiPath)
        assert.ok(!stdout.includes('Eşleştirme kodu'))
        reject = stdout.match(/text="Reddet"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      }
      assert.ok(reject, 'Expected the approval dialog on the attached Android device')
      const [, x1, y1, x2, y2] = reject.map(Number)
      await callAdb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1))
      await new Promise(resolve => setTimeout(resolve, 1200))
      assert.equal(await js(`window.kapanisDesktop.invoke('eon2:pairing:state', {id:${JSON.stringify(offer.id)}})`), 'denied')
      assert.deepEqual((await js("window.kapanisDesktop.invoke('eon2:paired-devices')")).map(device => device.id), ['smoke-file-target'])
      console.log('Physical Android received the USB prompt and rejected it without pairing')
    } finally { await callAdb('shell', 'rm', '-f', uiPath).catch(() => {}) }
  }
  await fs.writeFile(path.join(output, 'smoke.json'), JSON.stringify({ passed: true, capturedAt: new Date().toISOString(), viewports: results, powerExecuted: false,
    navigation: { samples: responseTimes.length, p95Ms: responseTimes[Math.ceil(responseTimes.length * .95) - 1], maximumMs: responseTimes.at(-1), measurement: 'Click to two animation frames, local Windows Electron, light theme; not a broad hardware benchmark' } }, null, 2))
  console.log('Eon controls Electron smoke passed', JSON.stringify(results))
  runtime.close()
  app.exit(0)
})().catch(error => { console.error(error); runtime?.close(); app.exit(1) })
setTimeout(() => { console.error('Eon controls smoke timed out'); app.exit(1) }, 60000).unref()
