// Physical end-to-end smoke for the CURRENT Eon2 Devices/PhoneScreenSurface.
// Opens a scrcpy view from real UI, reads native HWND status, then stops it.
// Never injects Android touch/key events or executes user PC actions.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let phase = 'starting'
let win
const out = path.resolve('docs/eon2/qa-phone-current')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const waitFor = async (get, title, timeout = 20000) => {
  const limit = Date.now() + timeout
  let last
  while (Date.now() < limit) {
    last = await get()
    if (last) return last
    await sleep(300)
  }
  throw new Error(`Zaman aşımı: ${title} (${JSON.stringify(last)})`)
}

;(async () => {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'eon-physical-video-')))
  await app.whenReady()
  await fs.mkdir(out, { recursive:true })
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item.webContents.getURL().includes('index.html'))
    || BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
  assert.ok(win, 'Eon window missing')
  if (win.isMaximized()) win.unmaximize()
  win.setBounds({ x:60, y:40, width:1280, height:890 })
  win.show()
  // Real users see the video only while Eon is foreground. Chat/tool windows
  // often steal focus during automated tests; temporarily pin this test window.
  win.setAlwaysOnTop(true)
  win.moveTop()
  win.focus()
  const js = source => win.webContents.executeJavaScript(source)
  await waitFor(() => js('Boolean(window.kapanisDesktop && document.querySelector(\'.eon2-nav-item[title="Cihazlar"]\'))'), 'Eon ready')
  await js(`document.querySelector('[aria-label="Rehberi kapat"]')?.click()`)
  phase = 'open-devices'
  await js(`document.querySelector('.eon2-nav-item[title="Cihazlar"]').click()`)
  await waitFor(() => js('Boolean(document.querySelector(".eon2-phone-viewport"))'), 'PhoneScreenSurface ready')
  await waitFor(() => js('!document.hidden'), 'Eon is foreground')
  const eligible = await js(`window.kapanisDesktop.invoke('eon2:devices')`)
  const requested = process.env.EON_SMOKE_USB_SERIAL
  const usb = eligible.devices.filter(device => device.usb && device.state === 'device')
  const device = requested ? usb.find(item => item.serial === requested) : usb.length === 1 ? usb[0] : null
  assert.ok(device, 'Expected exactly one authorised ADB USB device or EON_SMOKE_USB_SERIAL')
  phase = 'show-video-slot'
  await js(`[...document.querySelectorAll('.eon2-phone-orientation-switch button')].find(button=>button.textContent.includes('Yatay')).click()`)
  await sleep(250)
  await js(`document.querySelector('.eon2-phone-viewport').scrollIntoView({block:'center',inline:'center'})`)
  await sleep(300)
  const slot = await js(`(() => {
    const element=document.querySelector('.eon2-phone-viewport')
    const rect=element.getBoundingClientRect()
    return {x:rect.x,y:rect.y,w:rect.width,h:rect.height,viewport:innerHeight}
  })()`)
  assert.ok(slot.w>=48 && slot.h>=48 && slot.w>slot.h*1.5 && slot.y<slot.viewport && slot.y+slot.h>0, 'Landscape video slot not visible')
  phase = 'start-video'
  await js(`(() => {
    const select=document.querySelector('.eon2-phone-picker select')
    const serial=${JSON.stringify(device.serial)}
    if(![...select.options].some(option=>option.value===serial)) throw Error('USB device missing in picker')
    select.value=serial
    select.dispatchEvent(new Event('change',{bubbles:true}))
    const start=[...document.querySelectorAll('.eon2-phone-actions button')].find(button=>button.textContent.includes('Ekranı aç'))
    if(!start || start.disabled) throw Error('Start disabled')
    start.click()
  })()`)
  const getStatus = () => js(`window.kapanisDesktop.invoke('eon2:scrcpy:status')`)
  const running = await waitFor(async () => {
    const status=await getStatus()
    if (status.state === 'error') throw new Error(status.message)
    return status.state==='running' && status.mode==='embedded' && status
  }, 'Embedded scrcpy running', 25000)
  await sleep(1300)
  assert.equal((await getStatus()).state,'running')

  phase = 'native-window-check'
  const koffi=require('koffi')
  const user32=koffi.load('user32.dll')
  const findWindow=user32.func('uintptr_t __stdcall FindWindowW(void *className, str16 title)')
  const isVisible=user32.func('bool __stdcall IsWindowVisible(uintptr_t window)')
  const getWindow=user32.func('uintptr_t __stdcall GetWindow(uintptr_t window, uint32_t command)')
  const hwndByTitle=findWindow(null,`Eon Android – ${device.serial}`)
  const windowBuffer=win.getNativeWindowHandle()
  const mainHwnd=windowBuffer.length>=8 ? windowBuffer.readBigUInt64LE() : windowBuffer.readUInt32LE()
  let cursor=getWindow(mainHwnd,0)
  const owned=[]
  for(let i=0;cursor&&i<1024;i++){
    if(BigInt(getWindow(cursor,4))===BigInt(mainHwnd)) owned.push({hwnd:cursor,visible:isVisible(cursor)})
    const next=getWindow(cursor,2)
    if(!next||BigInt(next)===BigInt(cursor))break
    cursor=next
  }
  const hwnd=owned.find(item=>item.visible)?.hwnd ?? hwndByTitle
  const liveStatus=await getStatus()
  const visibility=await js(`(() => {
    const video=document.querySelector('.eon2-phone-viewport')
    const rect=video.getBoundingClientRect()
    const center=document.elementFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2)
    return {windowHidden:document.hidden,clientWidth:document.documentElement.clientWidth,
      viewport:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      centerTag:center?.tagName,centerClass:center?.className,inside:video.contains(center),
      liveText:document.querySelector('.eon2-phone-status')?.textContent,
      preview:document.querySelector('.eon2-phone-shell')?.getBoundingClientRect().toJSON?.(),
      appVisible:!!document.querySelector('.eon2-content'),
    }
  })()`)
  let nativeCapture
  try {
    const display=screen.getDisplayMatching(win.getBounds())
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:display.size})
    if(sources[0]){nativeCapture='eon-devices-video-diagnostic.png'; await fs.writeFile(path.join(out,nativeCapture),sources[0].thumbnail.toPNG())}
  } catch {}
  await fs.writeFile(path.join(out,'diagnostics.json'),JSON.stringify({liveStatus,visibility,slot,hwnd:String(hwnd),byTitle:String(hwndByTitle),owned:owned.map(item=>({...item,hwnd:String(item.hwnd)})),isVisible:hwnd?isVisible(hwnd):false,
    nativeCapture,windowBounds:win.getBounds(),contentBounds:win.getContentBounds()},null,2))
  assert.ok(hwnd && isVisible(hwnd),'Native video overlay is not visible')
  const nativeOwner=getWindow(hwnd,4)
  assert.equal(BigInt(nativeOwner),BigInt(mainHwnd),'Native video must be owned by Eon window')
  const report = { passed:true, device:device.model ?? device.serial, serial:device.serial,
    mode:running.mode, state:running.state, slot, nativeVisible:true, nativeOwnedByEon:true,
    date:new Date().toISOString(), inputsInjected:false }
  const hold=Number(process.env.EON_SMOKE_HOLD_MS || 0)
  if(Number.isInteger(hold)&&hold>0&&hold<=30000){
    await fs.writeFile(path.join(out,'hold-ready.json'),JSON.stringify({at:new Date().toISOString(),slot},null,2))
    await sleep(hold)
  }

  phase = 'physical-capture'
  try {
    await sleep(1200)
    win.focus()
    const display=screen.getDisplayMatching(win.getBounds())
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:display.size})
    const source=sources.find(item=>item.id.includes(String(display.id))) ?? sources[0]
    if (source) await fs.writeFile(path.join(out,'eon-devices-live-scrcpy.png'),source.thumbnail.toPNG())
    else report.capture='unavailable'
    await fs.writeFile(path.join(out,'eon-devices-renderer.png'),(await win.webContents.capturePage()).toPNG())
    const videoSources=await desktopCapturer.getSources({ types:['window'],thumbnailSize:{width:1600,height:950} })
    const videoSource=videoSources.find(item=>item.name.startsWith('Eon Android '))
    if (videoSource && !videoSource.thumbnail.isEmpty()) {
      await fs.writeFile(path.join(out,'eon-native-video.png'),videoSource.thumbnail.toPNG())
      report.nativeVideoCapture=true
    } else report.nativeVideoCapture=false
  } catch (error) { report.capture=String(error) }

  phase = 'stop-video'
  await js(`(() => {
    const stop=[...document.querySelectorAll('.eon2-phone-actions button')].find(button=>button.textContent.includes('Oturumu bitir'))
    if(!stop||stop.disabled) throw Error('Stop button unavailable')
    stop.click()
  })()`)
  await waitFor(async () => (await getStatus()).state === 'idle','scrcpy stop')
  report.stopped=true
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2))
  await fs.rm(path.join(out,'error.txt'),{force:true})
  console.log('Physical Eon2 Devices scrcpy smoke passed:',JSON.stringify(report))
  win.setAlwaysOnTop(false)
  runtime?.close()
  app.exit(0)
})().catch(async error => {
  console.error(phase,error)
  await fs.mkdir(out,{recursive:true}).catch(()=>{})
  await fs.writeFile(path.join(out,'error.txt'),`${phase}: ${error?.stack ?? error}`).catch(()=>{})
  try { await win?.webContents.executeJavaScript(`window.kapanisDesktop.invoke('eon2:scrcpy:stop')`) } catch {}
  try { win?.setAlwaysOnTop(false) } catch {}
  try { runtime?.close() } catch {}
  app.exit(1)
})
