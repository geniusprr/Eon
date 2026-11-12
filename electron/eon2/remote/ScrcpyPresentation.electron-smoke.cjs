// Physical Windows + authorised USB smoke. This runs in an isolated Electron
// window and never modifies the user's active Eon process.
//   npm run build:electron
//   $env:EON_SCRCPY_SERIAL='USB_SERIAL'; .\node_modules\.bin\electron.cmd electron/eon2/remote/ScrcpyPresentation.electron-smoke.cjs
// Optional screenshot: $env:EON_SCRCPY_SCREENSHOT='C:\Temp\eon-scrcpy-smoke.png'
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, screen } = require('electron')
const koffi = require('koffi')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const user32 = koffi.load('user32.dll')
koffi.struct('EonSmokeRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
const getRect = user32.func('bool __stdcall GetWindowRect(uintptr_t window, _Out_ EonSmokeRect *rect)')
const isVisible = user32.func('bool __stdcall IsWindowVisible(uintptr_t window)')
const getWindow = user32.func('uintptr_t __stdcall GetWindow(uintptr_t window, uint32_t command)')
const place = user32.func('bool __stdcall SetWindowPos(uintptr_t window, uintptr_t after, int x, int y, int width, int height, uint32_t flags)')
const topmost = BigInt.asUintN(64, -1n)
const notTopmost = BigInt.asUintN(64, -2n)
const SWP_NOSIZE_NOMOVE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010

function rectOf(hwnd) {
  const rect = { left: 0, top: 0, right: 0, bottom: 0 }
  assert.equal(getRect(hwnd, rect), true, 'GetWindowRect must succeed')
  return rect
}
function assertNear(actual, expected, message, margin = 3) {
  assert.ok(Math.abs(actual - expected) <= margin, `${message}: got ${actual} expected ${expected}`)
}

async function run() {
  if (process.platform !== 'win32') throw new Error('Physical smoke only supports Windows')
  const serial = process.env.EON_SCRCPY_SERIAL
  if (!serial) throw new Error('EON_SCRCPY_SERIAL must be an authorised USB ADB device')

  const { ScrcpyManager } = await import('../../../dist-electron/electron/eon2/remote/ScrcpyManager.js')
  const { ScrcpyPresentation } = await import('../../../dist-electron/electron/eon2/remote/ScrcpyPresentation.js')
  const main = new BrowserWindow({
    width: 600, height: 800, x: 80, y: 75, show: true,
    backgroundColor: '#ce6687', webPreferences: { sandbox: true, nodeIntegration: false },
  })
  let manager
  let presentation
  try {
    main.removeMenu()
    await main.loadURL('data:text/html,' + encodeURIComponent('<html><body style="margin:0;background:#dd6688;font:24px sans-serif"><p>Isolated native Android video smoke</p></body></html>'))
    manager = new ScrcpyManager()
    presentation = new ScrcpyPresentation(main, manager)
    const [viewportWidth, viewportHeight] = main.getContentSize()
    const slot = { x: 40, y: 100, width: 400, height: 570, viewportWidth, viewportHeight }
    presentation.layout(slot)
    console.log('Starting physical scrcpy smoke for USB device', serial)
    await manager.start(serial, { maxSize: 1280, maxFps: 30, bitRateMbps: 4 })
    const deadline = Date.now() + 15_000
    while (manager.getStatus().state === 'starting' && Date.now() < deadline) await wait(120)
    assert.equal(manager.getStatus().state, 'running', JSON.stringify(manager.getStatus()))
    const child = manager.getWindow()
    assert.ok(child, 'Real scrcpy native HWND missing')
    const nativeBuffer = main.getNativeWindowHandle()
    const owner = nativeBuffer.length >= 8 ? nativeBuffer.readBigUInt64LE() : nativeBuffer.readUInt32LE()
    assert.equal(BigInt(getWindow(child, 4)), BigInt(owner), 'Embedded SDL window must be owned by Electron')
    assert.equal(isVisible(child), true, 'Native embedded video must be visible')

    const initial = rectOf(child)
    const content = main.getContentBounds()
    const expected = screen.dipToScreenRect(main, {
      x: content.x + Math.round(slot.x * content.width / viewportWidth),
      y: content.y + Math.round(slot.y * content.height / viewportHeight),
      width: Math.round(slot.width * content.width / viewportWidth),
      height: Math.round(slot.height * content.height / viewportHeight),
    })
    assertNear(initial.left, expected.x, 'Embedded video x')
    assertNear(initial.top, expected.y, 'Embedded video y')
    assertNear(initial.right - initial.left, expected.width, 'Embedded video width')
    assertNear(initial.bottom - initial.top, expected.height, 'Embedded video height')
    console.log('Embedded HWND aligned with DOM slot', { child: String(child), owner: String(owner), rect: initial })

    // A screenshot proves D3D produces actual pixels above Chromium. Topmost
    // is temporary and local to this test; production stays an owned popup.
    const screenshot = process.env.EON_SCRCPY_SCREENSHOT
    if (screenshot) {
      main.setAlwaysOnTop(true)
      assert.ok(place(child, topmost, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE))
      await wait(550)
      const bounds = main.getBounds()
      const physical = screen.dipToScreenRect(main, bounds)
      const output = path.resolve(screenshot)
      fs.mkdirSync(path.dirname(output), { recursive: true })
      const powershell = [
        'Add-Type -AssemblyName System.Drawing',
        `$capture = New-Object System.Drawing.Bitmap(${physical.width},${physical.height})`,
        '$drawing = [System.Drawing.Graphics]::FromImage($capture)',
        `$drawing.CopyFromScreen(${physical.x},${physical.y},0,0,[System.Drawing.Size]::new(${physical.width},${physical.height}))`,
        `$capture.Save(${JSON.stringify(output)})`,
        '$drawing.Dispose()',
        '$capture.Dispose()',
      ].join('; ')
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershell], { windowsHide: true, timeout: 10000 })
      console.log('Embedded physical video screenshot:', output)
      assert.ok(place(child, notTopmost, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE))
      main.setAlwaysOnTop(false)
    }

    // Move desktop window: native embedded video tracks without stealing focus.
    const oldPos = main.getPosition()
    main.setPosition(oldPos[0] + 90, oldPos[1] + 55)
    await wait(750)
    const moved = rectOf(child)
    assert.ok(moved.left !== initial.left && moved.top !== initial.top, 'Video must follow desktop main window')
    const oldContent = content
    const newContent = main.getContentBounds()
    const expectedMoveX = screen.dipToScreenPoint({ x: newContent.x - oldContent.x, y: 0 }).x - screen.dipToScreenPoint({ x: 0, y: 0 }).x
    assertNear(moved.left - initial.left, expectedMoveX, 'Move follows desktop x', 4)
    console.log('Native video followed desktop move:', moved.left - initial.left, moved.top - initial.top)

    main.minimize()
    await wait(700)
    assert.equal(isVisible(child), false, 'Embedded video must hide when main is minimised')
    main.restore()
    await wait(700)
    assert.equal(isVisible(child), true, 'Embedded video must reappear when restored')

    presentation.layout(null)
    // ShowWindowAsync queues the state change on SDL's GUI thread.
    await wait(300)
    assert.equal(isVisible(child), false, 'Unmount must hide video overlay')
    presentation.layout(slot)
    await wait(300)
    assert.equal(isVisible(child), true, 'Remount must show real video again')

    assert.equal(presentation.setMode('window').mode, 'window')
    assert.equal(BigInt(getWindow(child, 4)), 0n, 'External mode must not remain owned by Electron')
    assert.equal(presentation.setMode('pip').mode, 'pip')
    assert.equal(presentation.setMode('embedded').mode, 'embedded')
    assert.equal(BigInt(getWindow(child, 4)), BigInt(owner), 'Embedded mode must restore HWND owner')
    assert.equal(manager.getStatus().state, 'running')
    console.log('PASS: real Android video startup, HWND owner, screen bounds, move, minimise, restore, scroll hide, external/PiP transitions')
  } finally {
    presentation?.dispose()
    manager?.dispose()
    // scrcpy is a separate SDL process; wait for native HWND teardown before
    // destroying its owner and Electron's Win32 message queue.
    await wait(1200)
    if (!main.isDestroyed()) main.destroy()
    await wait(300)
    app.quit()
  }
}

app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
