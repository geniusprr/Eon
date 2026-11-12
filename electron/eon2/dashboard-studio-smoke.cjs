const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')

process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let stage = 'setup'
const output = path.resolve('docs/eon2/qa-dashboard-studio')

;(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-dashboard-studio-'))
  app.setPath('userData', profile)
  await app.whenReady()
  await fs.mkdir(output, { recursive: true })
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html')) || BrowserWindow.getAllWindows()[0]
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  const js = source => win.webContents.executeJavaScript(source)
  const settle = () => new Promise(resolve => setTimeout(resolve, 400))
  await settle()
  await js(`document.querySelector('[aria-label="Rehberi kapat"]')?.click()`)
  await settle()
  assert.equal(await js('!!document.querySelector(".eon-studio")'), true)
  assert.equal(await js('!!document.querySelector(".eon-studio-tile--phone .eon2-phone-shell")'), true)
  assert.equal(await js('!!document.querySelector(".eon2-kanban")'), false)
  assert.equal(await js('!!document.querySelector(".eon-deck")'), false)

  const screens = []
  for (const [width,height] of [[720,900],[900,720],[1440,900],[1920,1080],[3840,2160]]) {
    stage = `viewport-${width}`
    win.setContentSize(width,height)
    await settle()
    await js(`document.querySelector('.eon-studio-canvas').scrollTop=0`)
    await settle()
    const metrics = await js(`(() => {
      const rect = element => document.querySelector(element).getBoundingClientRect()
      const sidebar = rect('.eon2-sidebar'), header = rect('.eon2-topbar'), phone = rect('.eon-studio-tile--phone')
      const app = rect('.eon2-app'), canvas = rect('.eon-studio-canvas')
      const cards = [...document.querySelectorAll('.eon-studio-tile')].map(element => element.getBoundingClientRect())
      return {
        width:innerWidth,height:innerHeight,cols:Number(document.querySelector('.eon-studio-grid').dataset.columns),
        horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        sidebarVisible: sidebar.width > 40 && sidebar.right < innerWidth,
        headerVisible:header.height >= 30 && header.width > innerWidth * .6,
        phoneVisible:phone.width >= 150 && phone.height >= 290 && phone.top < canvas.bottom && phone.bottom > canvas.top,
        canvasVisible:canvas.width > innerWidth * .5,
        cardsOverlapping:cards.some((a,i) => cards.slice(i+1).some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)),
      }
    })()`)
    assert.equal(metrics.horizontalOverflow, false, `horizontal overflow at ${width}`)
    assert.equal(metrics.sidebarVisible, true, `sidebar hidden at ${width}`)
    assert.equal(metrics.headerVisible, true, `header hidden at ${width}`)
    assert.equal(metrics.phoneVisible, true, `phone missing at ${width}`)
    assert.equal(metrics.canvasVisible, true, `dashboard canvas collapsed at ${width}`)
    assert.equal(metrics.cardsOverlapping, false, `cards collide at ${width}`)
    screens.push(metrics)
    if (width === 720 || width === 900 || width === 1440 || width === 1920) {
      await fs.writeFile(path.join(output, `studio-${width}.png`), (await win.webContents.capturePage()).toPNG())
    }
  }
  win.setContentSize(1440,900)
  await settle()
  stage = 'apply-minimal-preset'
  await js(`document.querySelector('.eon-studio-menu summary').click()`)
  await js(`[...document.querySelectorAll('.eon-studio-preset-menu button')].find(button => button.textContent.includes('Minimal')).click()`)
  await settle()
  assert.equal(await js('document.querySelectorAll(".eon-studio-tile").length'), 4)

  stage = 'enable-editing'
  await js(`document.querySelector('.eon-studio-edit').click()`)
  assert.equal(await js(`document.querySelector('.eon-studio-edit').getAttribute('aria-pressed')`), 'true')
  await js(`document.querySelector('.eon-studio-canvas').scrollTop=0`)
  await settle()
  stage = 'native-pointer-drag'
  const pointer = await js(`(() => {
    const rect = document.querySelector('[data-studio-widget="phone"] .eon-studio-handle').getBoundingClientRect()
    const grid = document.querySelector('.eon-studio-grid')
    const width = grid.getBoundingClientRect().width
    const columns = Number(grid.dataset.columns)
    return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2),
      distance:Math.ceil(((width - 12*(columns-1)) / columns + 12)*1.2)}
  })()`)
  const startColumn = await js(`document.querySelector('[data-studio-widget="phone"]').style.gridColumn`)
  const debuggerClient = win.webContents.debugger
  debuggerClient.attach('1.3')
  try {
    await debuggerClient.sendCommand('Input.dispatchMouseEvent', { type:'mousePressed', x:pointer.x, y:pointer.y, button:'left', clickCount:1 })
    await new Promise(resolve => setTimeout(resolve, 90))
    await debuggerClient.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x:pointer.x+Math.round(pointer.distance/2), y:pointer.y, button:'left', buttons:1 })
    await new Promise(resolve => setTimeout(resolve, 90))
    await debuggerClient.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x:pointer.x+pointer.distance, y:pointer.y, button:'left', buttons:1 })
    await new Promise(resolve => setTimeout(resolve, 130))
    await debuggerClient.sendCommand('Input.dispatchMouseEvent', { type:'mouseReleased', x:pointer.x+pointer.distance, y:pointer.y, button:'left', clickCount:1 })
  } finally { debuggerClient.detach() }
  await settle()
  assert.notEqual(await js(`document.querySelector('[data-studio-widget="phone"]').style.gridColumn`), startColumn)
  stage = 'keyboard-resize'
  const before = await js(`document.querySelector('[data-studio-widget="phone"]').style.gridColumn`)
  await js(`document.querySelector('[data-studio-widget="phone"] .eon-studio-resize-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))`)
  await settle()
  const after = await js(`document.querySelector('[data-studio-widget="phone"]').style.gridColumn`)
  assert.notEqual(before, after)

  stage = 'add-card'
  await js(`[...document.querySelectorAll('.eon-studio-menu summary')].find(item=>item.textContent.includes('Kart ekle')).click()`)
  await js(`[...document.querySelectorAll('.eon-studio-library button')].find(item=>item.textContent.includes('Ekran kartı')).click()`)
  await settle()
  assert.equal(await js(`!!document.querySelector('[data-studio-widget="gpu"]')`), true)
  stage = 'save-on-reload'
  const saved = await js(`localStorage.getItem('eon2:dashboard-studio:v2')`)
  win.webContents.reload()
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  await settle()
  assert.equal(await js(`localStorage.getItem('eon2:dashboard-studio:v2')`), saved)
  assert.equal(await js(`!!document.querySelector('[data-studio-widget="gpu"]')`), true)
  stage = 'navigation'
  await js(`[...document.querySelectorAll('.eon2-nav-item')].find(button=>button.title==='Eon Notes').click()`)
  await settle()
  assert.equal(await js(`!!document.querySelector('.eon2-notes-layout')`), true)
  await js(`document.querySelector('.eon2-logo').click()`)
  await settle()
  assert.equal(await js(`!!document.querySelector('.eon-studio')`), true)
  const report = { passed:true, date:new Date().toISOString(), screens, preset:'Minimal', editor:true, pointerDrag:true, keyboardResize:true, addWidget:true, persistence:true, navigation:true, powerActionsExecuted:false }
  await fs.writeFile(path.join(output,'smoke.json'),JSON.stringify(report,null,2))
  console.log('Eon dashboard studio smoke passed',JSON.stringify(report))
  runtime.close()
  app.exit(0)
})().catch(async error => {
  console.error(stage,error)
  await fs.mkdir(output,{recursive:true}).catch(()=>{})
  await fs.writeFile(path.join(output,'smoke-error.txt'),`${stage}: ${error?.stack || error}`).catch(()=>{})
  try { runtime?.close() } catch { /* original failure is more useful */ }
  app.exit(1)
})
