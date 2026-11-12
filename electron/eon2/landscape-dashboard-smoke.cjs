const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Run with node_modules/electron/dist/electron.exe electron/eon2/landscape-dashboard-smoke.cjs.
// This test only reads deck data and navigates the renderer; it never runs PC commands.
process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let stage = 'startup'

;(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-landscape-smoke-'))
  const output = path.resolve('docs/eon2/qa-landscape')
  app.setPath('userData', profile)
  await app.whenReady()
  await fs.mkdir(output, { recursive: true })
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  const js = code => window.webContents.executeJavaScript(code)
  const settle = () => new Promise(resolve => setTimeout(resolve, 500))
  await settle()
  await js('document.querySelector(\'[aria-label="Rehberi kapat"]\')?.click()')
  await settle()

  assert.equal(await js('Boolean(document.querySelector(".eon-deck"))'), true)
  assert.equal(await js('Boolean(document.querySelector(".eon2-kanban"))'), false)
  assert.equal(await js('Boolean(document.querySelector(".eon2-dashboard-phone"))'), false)
  assert.equal(await js('document.querySelectorAll(".eon-deck-gauge").length >= 3'), true)
  assert.equal(await js('document.querySelectorAll(".eon-deck-shortcut").length >= 4'), true)
  const deck = await js('window.kapanisDesktop.invoke("eon2:deck:get")')
  assert.ok(Array.isArray(deck.tools))
  assert.ok(Array.isArray(deck.actions))

  const results = []
  for (const [width, height] of [[720, 900], [900, 720], [1440, 900], [1920, 1080]]) {
    window.setContentSize(width, height)
    await settle()
    const layout = await js(`(() => {
      const deck = document.querySelector('.eon-deck')
      const body = document.querySelector('.eon-deck-body')
      const gauges = [...document.querySelectorAll('.eon-deck-gauge')]
      const clock = document.querySelector('.eon-deck-clock').getBoundingClientRect()
      const media = document.querySelector('.eon-deck-media').getBoundingClientRect()
      const keys = document.querySelector('.eon-deck-shortcuts').getBoundingClientRect()
      const footer = document.querySelector('.eon-deck-footer').getBoundingClientRect()
      const frame = deck.getBoundingClientRect()
      return {
        width: innerWidth, height: innerHeight,
        documentOverflow: document.documentElement.scrollWidth > innerWidth,
        bodyOverflow: body.scrollWidth > body.clientWidth + 1,
        frame: { x: frame.left, width: frame.width, right: frame.right },
        gaugeCount: gauges.length,
        mediaBelowClock: media.top > clock.bottom - 1,
        footerVisible: footer.top < innerHeight && footer.bottom <= innerHeight + 1,
        mediaAndKeysAligned: Math.abs(media.top - keys.top) < 2,
      }
    })()`)
    assert.equal(layout.documentOverflow, false, `Document overflows horizontally at ${width}`)
    assert.equal(layout.bodyOverflow, false, `Dashboard overflows horizontally at ${width}`)
    assert.equal(layout.mediaBelowClock, true, `Deck rows overlap at ${width}`)
    assert.equal(layout.mediaAndKeysAligned, true, `Media and shortcuts misaligned at ${width}`)
    assert.equal(layout.footerVisible, true, `Deck footer is clipped at ${width}`)
    assert.ok(layout.frame.width > width * .9, `Dashboard does not fill width at ${width}`)
    results.push(layout)
    await fs.writeFile(path.join(output, `deck-${width}.png`), (await window.webContents.capturePage()).toPNG())
  }

  stage = 'open shortcut page'
  await js('[...document.querySelectorAll(".eon-deck-pages button")].find(button => button.textContent.startsWith("Tuşlar")).click()')
  await settle()
  stage = 'verify shortcut page'
  assert.equal(await js('document.querySelector(".eon-deck-keys--page") !== null'), true)
  stage = 'open dashboard'
  await js('[...document.querySelectorAll(".eon-deck-pages button")].find(button => button.textContent === "Panel").click()')
  await settle()
  stage = 'verify dashboard'
  assert.equal(await js('document.querySelector(".eon-deck-dashboard") !== null'), true)
  stage = 'open notes'
  await js(`document.querySelector('.eon-deck-navigation button[title="Notları aç"]').click()`)
  await settle()
  stage = 'verify notes'
  assert.equal(await js('document.querySelector(".eon2-notes-layout") !== null'), true)
  stage = 'back to dashboard'
  await js('document.querySelector(".eon2-logo").click()')
  await settle()
  stage = 'verify return'
  assert.equal(await js('document.querySelector(".eon-deck-dashboard") !== null'), true)

  await fs.writeFile(path.join(output, 'smoke.json'), JSON.stringify({ passed:true, capturedAt:new Date().toISOString(), results, commandsExecuted:false }, null, 2))
  console.log('Eon landscape dashboard smoke passed', JSON.stringify(results))
  runtime.close()
  app.exit(0)
})().catch(async error => {
  console.error(error)
  await fs.writeFile(path.resolve('docs/eon2/qa-landscape/smoke-error.txt'), `${stage}: ${String(error?.stack || error)}`).catch(() => {})
  try { runtime?.close() } catch { /* preserve original failure */ }
  app.exit(1)
})
