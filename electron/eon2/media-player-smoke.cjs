const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

process.env.KAPANIS_SMOKE_TEST = '1'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const output = path.resolve('docs/eon2/qa-media-player')
let runtime
;(async () => {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'eon-media-player-')))
  await app.whenReady()
  await fs.mkdir(output, { recursive: true })
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  win.webContents.setBackgroundThrottling(false)
  const js = source => win.webContents.executeJavaScript(source)
  // Synthetic artwork is isolated to this QA process; no real media keys are sent.
  const artwork = await js(`(() => {
    const c=document.createElement('canvas');c.width=c.height=320;const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,320,320);g.addColorStop(0,'#f1aa77');g.addColorStop(.48,'#9a4470');g.addColorStop(1,'#20366b');
    x.fillStyle=g;x.fillRect(0,0,320,320);x.fillStyle='#fce5b4';x.beginPath();x.arc(210,100,52,0,7);x.fill();
    x.fillStyle='#162a49';x.beginPath();x.moveTo(0,240);x.lineTo(120,160);x.lineTo(220,230);x.lineTo(320,170);x.lineTo(320,320);x.lineTo(0,320);x.fill();
    x.fillStyle='white';x.font='24px sans-serif';x.fillText('Evening sessions',24,285);return c.toDataURL('image/jpeg');
  })()`)
  let media = { title: 'Evening sessions', artist: 'Eon · Görsel test', playing: true, artwork }
  let available = true
  const commands = []
  ipcMain.removeHandler('eon2:deck:get')
  ipcMain.handle('eon2:deck:get', () => ({ tools: [], actions: [], mediaAvailable: available, media }))
  ipcMain.removeHandler('eon2:deck:execute')
  ipcMain.handle('eon2:deck:execute', (_, payload) => { commands.push(payload.id); return { ok: true } })
  await js(`document.querySelector('[aria-label="Rehberi kapat"]')?.click()`)
  await wait(5500)
  const measurements = []
  for (const [width,height] of [[720,900],[900,720],[1440,900],[1920,1080],[3840,2160]]) {
    win.unmaximize(); win.setContentSize(width,height); await wait(450)
    const metrics = await js(`(() => {
      const p=document.querySelector('.eon-player'), surface=p.querySelector('.eon-player-surface');
      const r=p.getBoundingClientRect();
      return { width:innerWidth, pageOverflow:document.documentElement.scrollWidth>innerWidth+2,
        playerWidth:r.width, playerHeight:r.height, horizontalOverflow:surface.scrollWidth>surface.clientWidth+1,
        buttons:p.querySelectorAll('button').length,
        imageLoaded:p.querySelector('.eon-player-cover img')?.naturalWidth>0,
        ambilight:!!p.querySelector('.eon-player-ambilight'),
        buttonsInside:[...p.querySelectorAll('button')].every(b=>{const x=b.getBoundingClientRect();return x.left>=r.left && x.right<=r.right+1}),
      };
    })()`)
    console.log(JSON.stringify(metrics))
    await fs.writeFile(path.join(output,`player-${width}.png`),(await win.webContents.capturePage()).toPNG())
    assert.equal(metrics.pageOverflow,false)
    assert.equal(metrics.horizontalOverflow,false)
    assert.equal(metrics.buttons,4)
    assert.equal(metrics.imageLoaded,true)
    assert.equal(metrics.ambilight,true)
    assert.equal(metrics.buttonsInside,true)
    measurements.push(metrics)
  }
  await js(`document.querySelector('.eon-player [aria-label="Ses kontrolleri"]').click()`)
  await wait(250)
  assert.equal(await js(`document.querySelectorAll('.eon-player-volume-panel button').length`),3)
  assert.equal(await js(`(() => { const r=document.querySelector('.eon-player-volume-panel').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight })()`),true)
  await js(`document.querySelector('.eon-player-volume-panel [aria-label="Sesi azalt"]').click()`)
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  await wait(200)
  assert.equal(await js(`!!document.querySelector('.eon-player-volume-panel')`),false)
  await js(`document.querySelector('.eon-player [aria-label="Duraklat"]').click()` )
  await wait(250)
  assert.deepEqual(commands,['volumeDown','playPause'])
  media = { ...media, playing: false, title: 'Uzun parça başlığı '.repeat(10), artist: 'Uzun sanatçı adı '.repeat(10), artwork: null }
  win.setContentSize(1440,900); win.show(); win.focus()
  win.reload()
  await new Promise(resolve => win.webContents.once('did-finish-load',resolve))
  await wait(1200)
  assert.equal(await js(`!!document.querySelector('.eon-player [aria-label="Oynat"]')`),true)
  assert.equal(await js(`!!document.querySelector('.eon-player-ambilight')`),false)
  await js(`document.querySelector('.eon-player [aria-label="Oynat"]').focus()`)
  assert.equal(await js(`document.activeElement?.getAttribute('aria-label')`),'Oynat')
  available = false; media = null
  win.reload()
  await new Promise(resolve => win.webContents.once('did-finish-load',resolve))
  await wait(1200)
  assert.equal(await js(`document.querySelectorAll('.eon-player button:disabled').length`),4)
  assert.equal(await js(`!!document.querySelector('.eon-player-ambilight')`),false)
  const { WindowsDeckTelemetry } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/agent/WindowsDeckTelemetry.js')).href)
  const live = await new WindowsDeckTelemetry(path.join(process.env.SystemRoot,'System32')).readMedia()
  if (live?.artwork) {
    media = live; available = true
    win.reload()
    await new Promise(resolve => win.webContents.once('did-finish-load',resolve))
    await wait(1200)
    await fs.writeFile(path.join(output,'player-live.png'),(await win.webContents.capturePage()).toPNG())
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({ fixture:true, measurements, commands },null,2))
  console.log('Media player smoke passed: artwork, ambilight, playback and volume panel, command dispatch, keyboard focus and five viewport sizes.')
  runtime.close(); app.exit(0)
})().catch(error => { console.error(error); runtime?.close(); app.exit(1) })
