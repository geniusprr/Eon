const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let phase = 'startup'
const target = path.resolve('docs/eon2/qa-deck-mirror')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

;(async () => {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'eon-deck-mirror-')))
  await app.whenReady()
  await fs.mkdir(target, { recursive: true })
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  win.webContents.on('console-message', (...args) => { const event = args[0]; if (event?.details?.level === 'error' || event?.level === 'error' || args[1] === 3) console.error('renderer:', event?.details?.message ?? event?.message ?? args[2]) })
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  const js = source => win.webContents.executeJavaScript(source)
  let actionCalls = 0
  // This isolated smoke must never launch real PC commands.
  for (const channel of ['eon2:deck:execute', 'eon2:actions:execute']) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => { actionCalls++; return { ok:true } })
  }
  for (let attempt=0; attempt<30; attempt++) { if (await js('!!document.querySelector(".eon-mirror-phone")')) break; await wait(250) }
  await js(`document.querySelector('[aria-label="Rehberi kapat"]')?.click()`)
  await wait(450)
  assert.equal(await js('!!document.querySelector(".eon-mirror-phone")'), true)
  assert.equal(await js('!!document.querySelector(".eon2-sidebar")'), true)
  assert.equal(await js('!!document.querySelector(".eon2-topbar")'), true)
  assert.equal(await js('!!document.querySelector(".eon2-kanban")'), false)
  assert.equal(await js('document.querySelectorAll(".eon-mirror-tile").length'), 7)
  assert.equal((await js('window.kapanisDesktop.invoke("eon2:deck:layout:get")')).revision, 0)

  const results = []
  for (const [width, height] of [[720, 900], [900, 720], [1440, 900], [1920, 1080], [3840, 2160]]) {
    phase = `responsive-${width}`
    win.unmaximize()
    win.setContentSize(width, height)
    await wait(550)
    const measure = await js(`(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect()
      const shell = box('.eon-mirror-phone')
      const screen = box('.eon-mirror-display')
      const grid = box('.eon-mirror-grid')
      const cards = [...document.querySelectorAll('.eon-mirror-tile')].map(tile => ({
        id:tile.dataset.deckWidget, r:tile.getBoundingClientRect(),
      }))
      return {
        innerWidth, innerHeight,
        pageOverflow:document.documentElement.scrollWidth > innerWidth + 2,
        frameWidth:shell.width, frameHeight:shell.height,
        headerVisible:box('.eon2-topbar').width > innerWidth*.5,
        sidebarVisible:box('.eon2-sidebar').width > 45,
        frameInside:screen.left >= shell.left && screen.right <= shell.right && screen.top >= shell.top && screen.bottom <= shell.bottom,
        gaugeCount:document.querySelectorAll('.eon-mirror-gauge').length,
        cardsInside:cards.every(({r})=>r.left >= grid.left - 3 && r.right <= grid.right + 3 && r.top >= grid.top - 3 && r.bottom <= grid.bottom + 3),
        overlaps:cards.some((a,i)=>cards.slice(i+1).some(b=>Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>3 && Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>3)),
      }
    })()`)
    assert.equal(measure.pageOverflow, false, `horizontal page overflow ${width}`)
    assert.equal(measure.headerVisible, true, `header changed ${width}`)
    assert.equal(measure.sidebarVisible, true, `sidebar changed ${width}`)
    assert.equal(measure.frameInside, true, `phone frame clipped ${width}`)
    assert.equal(measure.cardsInside, true, `deck card outside frame ${width}`)
    assert.equal(measure.overlaps, false, `deck card overlaps ${width}`)
    assert.equal(measure.gaugeCount, 4)
    results.push(measure)
    if (width !== 3840) await fs.writeFile(path.join(target, `mirror-${width}.png`), (await win.webContents.capturePage()).toPNG())
  }

  // Return from the 4K geometry before interactive screenshots; Windows may clamp
  // a huge offscreen window to the physical display until explicit bounds reset.
  phase = 'editing'
  win.setBounds({ x: 40, y: 40, width: 1440, height: 900 }, true)
  win.setContentSize(1380, 840)
  await wait(550)
  assert.equal(await js('!!document.querySelector(".eon-mirror-title-row")'), false)
  assert.equal(await js('!!document.querySelector(".eon-mirror-head")'), false)
  assert.equal(await js('document.querySelectorAll(".eon-mirror-handle,.eon-mirror-hide,.eon-mirror-resizer").length'), 0)
  assert.equal(await js('document.querySelector(".eon2-logo-word").textContent'), 'Eon')
  await js(`document.querySelector('.eon-mirror-grid').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:200}))`)
  await js(`[...document.querySelectorAll('.eon-mirror-context button')].find(x=>x.textContent.includes('Minimal düzeni')).click()`)

  assert.equal(await js('!!document.querySelector(".eon-mirror-grid.is-editing")'), true)

  phase = 'preset-and-cas'
  await js(`document.querySelector('.eon-mirror-presets summary').click()`)
  await js(`[...document.querySelectorAll('.eon-mirror-presets-menu button')].find(x=>x.textContent.includes('Minimal')).click()`)
  await wait(350)
  assert.equal(await js('document.querySelectorAll(".eon-mirror-tile").length'), 5)
  await js(`[...document.querySelectorAll('.eon-mirror-toolbar .eon-mirror-button')].find(x=>x.textContent.includes('Kaydet')).click()`)
  await wait(650)
  const saved = await js('window.kapanisDesktop.invoke("eon2:deck:layout:get")')
  assert.equal(saved.revision, 1)
  assert.equal(saved.widgets.filter(tile => tile.visible).length, 5)

  phase = 'keyboard-resize'

  await js(`document.querySelector('[data-deck-widget="clock"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}))`)
  await wait(90)
  await js(`document.querySelector('[data-deck-widget="clock"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}))`)
  await wait(200)
  const candidate = await js(`document.querySelector('[data-deck-widget="clock"]')?.style.gridColumn`)
  assert.equal(candidate, '1 / span 3')

  phase = 'pointer-drag'
  const pointer = await js(`(() => {
    const handle=document.querySelector('[data-deck-widget="clock"]').getBoundingClientRect()
    const grid=document.querySelector('.eon-mirror-grid').getBoundingClientRect()
    return {x:Math.round(handle.left+handle.width/2),y:Math.round(handle.top+handle.height/2),step:Math.round(grid.width/12)}
  })()`)
  const debuggerClient = win.webContents.debugger
  debuggerClient.attach('1.3')
  try {
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:pointer.x,y:pointer.y,button:'left',clickCount:1})
    await wait(90)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.x+pointer.step,y:pointer.y,button:'left',buttons:1})
    await wait(100)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointer.x+pointer.step,y:pointer.y,button:'left',clickCount:1})
  } finally { debuggerClient.detach() }
  await wait(250)
  assert.equal(await js(`document.querySelector('[data-deck-widget="clock"]').style.gridColumn`), '2 / span 3')

  phase = 'pointer-edge-resize'
  const edge = await js(`(() => {
    const r = document.querySelector('[data-deck-widget="clock"] .edge-e').getBoundingClientRect()
    const grid = document.querySelector('.eon-mirror-grid').getBoundingClientRect()
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),step:Math.round(grid.width/12)}
  })()`)
  debuggerClient.attach('1.3')
  try {
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:edge.x,y:edge.y,button:'left',clickCount:1})
    await wait(80)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:edge.x+8,y:edge.y,button:'left',buttons:1})
    await wait(80)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:edge.x+edge.step,y:edge.y,button:'left',buttons:1})
    await wait(100)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:edge.x+edge.step,y:edge.y,button:'left',clickCount:1})
  } finally { debuggerClient.detach() }
  await wait(150)
  assert.equal(await js(`document.querySelector('[data-deck-widget="clock"]').style.gridColumn`), '2 / span 4')
  // Restore the original width using keyboard before persistence assertions.
  await js(`document.querySelector('[data-deck-widget="clock"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}))`)
  await wait(100)
  await fs.writeFile(path.join(target, 'mirror-editing.png'), (await win.webContents.capturePage()).toPNG())

  phase = 'persist-reload'
  await js(`[...document.querySelectorAll('.eon-mirror-toolbar .eon-mirror-button')].find(x=>x.textContent.includes('Kaydet')).click()`)
  await wait(550)
  assert.equal((await js('window.kapanisDesktop.invoke("eon2:deck:layout:get")')).revision, 2)
  win.webContents.reload()
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  await wait(550)
  assert.equal(await js(`document.querySelector('[data-deck-widget="clock"]').style.gridColumn`), '2 / span 3')
  phase = 'shortcut-drag-and-click'
  const quick = await js(`(() => [...document.querySelectorAll('[data-quick-index]')].slice(0,2).map(el => {
    const r = el.getBoundingClientRect(); return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), title:el.title }
  }))()`)
  assert.equal(quick.length, 2)
  debuggerClient.attach('1.3')
  try {
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:quick[0].x,y:quick[0].y,button:'left',clickCount:1})
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:quick[1].x,y:quick[1].y,button:'left',buttons:1})
    await wait(100)
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:quick[1].x,y:quick[1].y,button:'left',clickCount:1})
  } finally { debuggerClient.detach() }
  await wait(150)
  assert.equal(await js(`document.querySelector('[data-quick-index="0"]').title`), quick[1].title)
  assert.equal(actionCalls, 0, 'drag must not execute a shortcut')
  const stable = await js(`(() => { const r=document.querySelector('[data-quick-index="0"]').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })()`)
  assert.equal(Math.abs(stable.y - quick[0].y) < 3, true, 'starting edit must not move the canvas')
  await js(`[...document.querySelectorAll('.eon-mirror-toolbar button')].find(x=>x.textContent.includes('Kaydet')).click()`)
  await wait(450)
  assert.equal((await js('window.kapanisDesktop.invoke("eon2:deck:layout:get")')).revision, 3)
  debuggerClient.attach('1.3')
  try {
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:stable.x,y:stable.y,button:'left',clickCount:1})
    await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:stable.x,y:stable.y,button:'left',clickCount:1})
  } finally { debuggerClient.detach() }
  await wait(100)
  assert.equal(actionCalls, 1, 'a regular click must still execute once')

  phase = 'phone-shortcut-pages'
  const created = await js(`Promise.all(Array.from({length:8}, (_, index) =>
    window.kapanisDesktop.invoke('eon2:actions:save', {
      name:'Test kısayolu ' + (index + 1), kind:'command', target:'Write-Output test', arguments:[], delaySeconds:0,
      ...(index === 0 ? {remoteEnabled:false} : {}),
    })))`)
  assert.ok(created.slice(1).every(action => action.remoteEnabled))
  const selectPage = value => js(`(() => {
    const select = document.querySelector('.eon-mirror-pages select')
    select.value = ${JSON.stringify(value)}
    select.dispatchEvent(new Event('change', {bubbles:true}))
  })()`)
  await selectPage('keys:0')
  for (let attempt=0; attempt<20; attempt++) {
    if (await js('document.querySelectorAll(".eon-mirror-all-keys button").length') === 12) break
    await wait(250)
  }
  const measureKeys = () => js(`(() => {
    const grid = document.querySelector('.eon-mirror-display > .eon-mirror-all-keys')
    const style = getComputedStyle(grid)
    const screen = grid.parentElement.getBoundingClientRect()
    const tile = grid.querySelector('button').getBoundingClientRect()
    return {
      columns:style.gridTemplateColumns.split(' ').length, rows:style.gridTemplateRows.split(' ').length,
      tiles:grid.querySelectorAll('button').length,
      sameInsets:Math.abs((tile.top - screen.top) - (tile.left - screen.left)) < 1,
    }
  })()`)
  assert.deepEqual(await measureKeys(), {columns:4, rows:3, tiles:12, sameInsets:true})
  await js('document.querySelector(".eon-mirror-all-keys [data-locked]").click()')
  assert.equal(actionCalls, 1, 'phone-locked shortcuts must show feedback without running')
  assert.match(await js('document.querySelector(".eon-mirror-foot-status").textContent'), /telefon erişimini aç/)
  await js(`[...document.querySelectorAll('.eon-mirror-key-pages button')].find(button => button.textContent === 'Tuşlar 2').click()`)
  assert.deepEqual(await measureKeys(), {columns:4, rows:3, tiles:4, sameInsets:true})
  await js(`document.querySelector('[aria-label="5×3 tuş dizilimine geç"]').click()`)
  assert.deepEqual(await measureKeys(), {columns:5, rows:3, tiles:1, sameInsets:true})
  await selectPage('keys:0')
  assert.deepEqual(await measureKeys(), {columns:5, rows:3, tiles:15, sameInsets:true})
  await fs.writeFile(path.join(target,'mirror-shortcut-pages.png'),(await win.webContents.capturePage()).toPNG())
  await selectPage('panel')

  phase = 'light-theme'
  await js(`window.kapanisDesktop.invoke('eon2:settings:set',{key:'theme',value:'light'})`)
  for (let attempt=0; attempt<15; attempt++) {
    if (await js('!!document.querySelector(".eon2-app.eon2-theme-light")')) break
    await wait(300)
  }
  assert.equal(await js('!!document.querySelector(".eon2-app.eon2-theme-light")'), true)
  assert.equal(await js('getComputedStyle(document.querySelector(".eon-mirror")).getPropertyValue("--mirror-bg").trim()'), '#e5eef7')
  await fs.writeFile(path.join(target,'mirror-light.png'),(await win.webContents.capturePage()).toPNG())
  phase = 'navigation'
  await js(`document.querySelector('.eon2-nav-item[title="Cihazlar"]').click()`)
  await wait(350)
  assert.equal(await js('!!document.querySelector(".eon2-phone-surface")'), true)
  await js(`document.querySelector('.eon2-logo').click()`)
  await wait(350)
  assert.equal(await js('!!document.querySelector(".eon-mirror-phone")'), true)

  await fs.rm(path.join(target, 'error.txt'), { force:true })
  await fs.rm(path.join(target, 'edge-debug.json'), { force:true })
  await fs.writeFile(path.join(target, 'smoke.json'), JSON.stringify({ passed:true, date:new Date().toISOString(),
    resolutions:results, liveActionsExecuted:false, layoutRevision:3, shortcutDrag:true, clickPreserved:true, edgeResize:true, contextMenu:true, lightTheme:true, keyboardResize:true, pointerDrag:true, savedPhoneMirror:true, navigation:true },null,2))
  console.log('Eon Deck mirror smoke passed')
  runtime.close()
  app.exit(0)
})().catch(async error => {
  console.error(phase,error)
  await fs.mkdir(target,{recursive:true}).catch(()=>{})
  await fs.writeFile(path.join(target,'error.txt'),`${phase}: ${error?.stack||error}`).catch(()=>{})
  try { runtime?.close() } catch { /* preserve failure */ }
  app.exit(1)
})
