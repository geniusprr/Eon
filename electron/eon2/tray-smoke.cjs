const { app, Tray } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')

process.env.KAPANIS_SMOKE_TEST = '1'
app.setAppUserModelId('com.kapanis.desktop.smoke')
app.commandLine.appendSwitch('background')

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-tray-smoke-'))
  app.setPath('userData', profile)
  await app.whenReady()
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  let menu
  let runtime
  const setContextMenu = Tray.prototype.setContextMenu
  Tray.prototype.setContextMenu = function (value) {
    menu = value
    return setContextMenu.call(this, value)
  }
  try {
    runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'),
      pathToFileURL(path.resolve('dist/index.html')).href)
  } finally {
    Tray.prototype.setContextMenu = setContextMenu
  }
  const window = runtime.windows.getMainWindow()
  assert.ok(window)
  if (window.webContents.isLoading()) await once(window.webContents, 'did-finish-load')
  const js = expression => window.webContents.executeJavaScript(expression)
  async function checkVisibility(visible) {
    for (let attempt = 0; attempt < 40 && window.isVisible() !== visible; attempt++) await delay(25)
    assert.equal(window.isVisible(), visible)
  }
  assert.equal(window.isVisible(), false, 'Windows startup should leave the main window hidden')
  const open = menu?.items.find(item => item.label === 'Aç')
  const quit = menu?.items.find(item => item.label === 'Çık')
  assert.ok(open && quit, 'The native tray menu must provide open and quit')
  open.click()
  await checkVisibility(true)
  window.close()
  assert.equal(window.isDestroyed(), false)
  await checkVisibility(false)
  open.click()
  await checkVisibility(true)
  await js("window.kapanisDesktop.invoke('window:close')")
  await checkVisibility(false)
  open.click()
  await checkVisibility(true)

  const settings = "window.kapanisDesktop.invoke('eon2:settings:get')"
  const setPreference = (key, enabled) => js(`window.kapanisDesktop.invoke('eon2:settings:set', {key:${JSON.stringify(key)},value:${enabled}})`)
  assert.equal((await js(settings)).closeToTray, true)
  assert.equal((await setPreference('closeToTray', false)).closeToTray, false)
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'eon-2', 'tray-settings.json'), 'utf8')).enabled, false)
  assert.equal((await setPreference('closeToTray', true)).closeToTray, true)
  try {
    assert.equal((await setPreference('autostart', true)).autostart, true)
    const login = { path: `"${process.execPath}"`, args: [app.getAppPath(), '--background'], name: 'com.kapanis.desktop.smoke' }
    assert.equal(app.getLoginItemSettings(login).executableWillLaunchAtLogin, true)
    app.setLoginItemSettings({ ...login, openAtLogin: true, enabled: false })
    assert.equal((await js(settings)).autostart, false, 'Windows may disable the startup item independently')
    assert.equal((await setPreference('autostart', true)).autostart, true)
  } finally {
    assert.equal((await setPreference('autostart', false)).autostart, false)
  }

  window.close()
  const willQuit = once(app, 'will-quit')
  app.once('will-quit', event => event.preventDefault())
  quit.click()
  await willQuit
  assert.equal(window.isDestroyed(), true)
  runtime.close()
}

run().then(() => {
  console.log('Windows tray, close, quit and login item smoke passed')
  app.exit(0)
}).catch(error => {
  console.error(error)
  app.exit(1)
})
setTimeout(() => {
  console.error('Windows tray smoke timed out')
  app.exit(1)
}, 30_000).unref()
