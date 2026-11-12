import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./ScrcpyPresentation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function fixture(workArea = { x: 0, y: 0, width: 1440, height: 900 }) {
  const events = []
  const hidden = new Set()
  const config = {
    scale: 1,
    content: { x: 100, y: 60, width: 1000, height: 800 },
    failPresent: false,
    nativeAlive: true,
  }
  const clientSizes = new Map([[777, { width: 256, height: 256 }]])

  class FakeBrowserWindow extends EventEmitter {
    destroyed = false
    visible = true
    minimized = false
    focused = false
    getNativeWindowHandle() {
      const buffer = Buffer.alloc(8)
      buffer.writeBigUInt64LE(1234n)
      return buffer
    }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    getContentBounds() { return { ...config.content } }
    getBounds() { return { x: config.content.x, y: config.content.y, width: config.content.width, height: config.content.height } }
    focus() { this.focused = true }
  }

  class FakeManager {
    status = { state: 'running', serial: 'USB123', mode: 'embedded', startedAt: 123 }
    listeners = new Set()
    getStatus() { return { ...this.status } }
    getWindow() { return this.status.state === 'running' ? 777 : null }
    subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback) }
    emit() { for (const callback of [...this.listeners]) callback(this.getStatus()) }
    setMode(mode) {
      if (this.status.state !== 'running') throw Error('not running')
      this.status = { ...this.status, mode }
      this.emit()
      return this.getStatus()
    }
    fail(message) {
      this.status = { state: 'error', message }
      this.emit()
      return this.getStatus()
    }
  }

  const native = {
    isScrcpyWindow: () => config.nativeAlive,
    presentScrcpy(child, owner, mode) {
      if (config.failPresent) throw Error('native popup ownership failed')
      assert.equal(child, 777)
      events.push(['present', child, owner, mode])
      hidden.add(child)
    },
    hideScrcpy(window) { events.push(['hide', window]); hidden.add(window) },
    getClientSize(window) { return clientSizes.get(window) ?? { width: 256, height: 256 } },
    placeScrcpy(window, x, y, width, height, topmost = false) {
      assert.equal(window, 777)
      events.push(['place', x, y, width, height, topmost])
      clientSizes.set(window, { width, height })
      hidden.delete(window)
    },
  }
  const fakeRequire = name => {
    if (name === 'electron') return {
      screen: {
        getDisplayMatching: () => ({ workArea }),
        dipToScreenRect(_window, bounds) {
          return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * config.scale)]))
        },
      },
    }
    if (name === './ScrcpyWindow.js') return native
    throw Error('Unexpected dependency ' + name)
  }
  const module = { exports: {} }
  const evaluate = vm.runInNewContext('(function(require,module,exports){' + compiled + '\n})', {
    Buffer, Error, setInterval: () => ({ unref() {} }), clearInterval,
  })
  evaluate(fakeRequire, module, module.exports)
  const main = new FakeBrowserWindow()
  const manager = new FakeManager()
  const presentation = new module.exports.ScrcpyPresentation(main, manager)
  return { manager, main, events, hidden, config, presentation, readSlot: module.exports.readPhoneScreenSlot }
}

const slot = { x: 100, y: 80, width: 300, height: 400, viewportWidth: 1000, viewportHeight: 800 }

test('rejects invalid renderer slot bounds before native positioning', () => {
  const { readSlot, presentation } = fixture()
  assert.equal(readSlot(null), null)
  assert.equal(readSlot({ ...slot, x: 100.5 }).x, 100.5)
  for (const bad of [undefined, {}, [], { ...slot, width: 47 }, { ...slot, height: NaN },
    { ...slot, x: -1 }, { ...slot, x: Infinity }, { ...slot, viewportWidth: 100 },
    { ...slot, viewportHeight: 0 }, { ...slot, height: 99999 }]) assert.throws(() => readSlot(bad))
  presentation.dispose()
})

test('owned popup stays embedded, hides on scroll/offscreen/minimise and shows after remount', () => {
  const { presentation, manager, main, events, hidden, config } = fixture()
  presentation.layout(slot)
  assert.deepEqual(events.find(event => event[0] === 'present'), ['present', 777, 1234n, 'embedded'])
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 200, 140, 300, 400, false])
  presentation.layout(null)
  assert.equal(hidden.has(777), true)
  assert.equal(manager.getStatus().state, 'running')
  presentation.layout(slot)
  assert.equal(hidden.has(777), false)
  config.content.width = 500
  config.content.height = 400
  presentation.layout(slot)
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 150, 100, 150, 200, false])
  main.minimized = true
  presentation.layout(slot)
  assert.equal(hidden.has(777), true)
  main.minimized = false
  presentation.layout(slot)
  assert.equal(hidden.has(777), false)
  presentation.dispose()
})

test('renderer CSS pixels become physical Win32 screen pixels exactly once at mixed DPI', () => {
  const { presentation, events, config } = fixture()
  config.scale = 1.5
  presentation.layout(slot)
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 300, 210, 450, 600, false])
  presentation.dispose()
})

test('an invalid slot hides the native video instead of covering a different DOM surface', () => {
  const { presentation, manager, events, hidden } = fixture()
  presentation.layout(slot)
  assert.throws(() => presentation.layout({ ...slot, width: 12000 }))
  assert.equal(hidden.has(777), true)
  assert.equal(manager.getStatus().state, 'running')
  assert.equal(events.filter(event => event[0] === 'present').length, 1)
  presentation.dispose()
})

test('real SDL popup switches embedded → window → PiP → embedded without a blank BrowserWindow', () => {
  const { presentation, main, manager, events } = fixture()
  presentation.layout(slot)
  assert.equal(presentation.setMode('window').mode, 'window')
  assert.deepEqual(events.findLast(event => event[0] === 'present'), ['present', 777, null, 'window'])
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 495, 80, 450, 740, false])
  const placed = events.filter(event => event[0] === 'place').length
  presentation.layout(slot)
  assert.equal(events.filter(event => event[0] === 'place').length, placed, 'dragged external window should not snap back')
  presentation.setMode('window')
  assert.equal(events.filter(event => event[0] === 'place').length, placed + 1, 'same mode reopens a minimised external window')
  assert.equal(presentation.setMode('pip').mode, 'pip')
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 1124, 399, 300, 485, true])
  assert.equal(presentation.setMode('embedded').mode, 'embedded')
  assert.deepEqual(events.findLast(event => event[0] === 'present'), ['present', 777, 1234n, 'embedded'])
  assert.deepEqual(events.findLast(event => event[0] === 'place'), ['place', 200, 140, 300, 400, false], 'PiP topmost released')
  assert.equal(main.focused, true)
  assert.equal(manager.getStatus().state, 'running')
  presentation.dispose()
})

test('failed native ownership or a destroyed scrcpy window closes the active session', () => {
  const first = fixture()
  first.config.failPresent = true
  first.presentation.layout(slot)
  assert.equal(first.manager.getStatus().state, 'error')
  assert.match(first.manager.getStatus().message, /ownership failed/)
  first.presentation.dispose()

  const second = fixture()
  second.presentation.layout(slot)
  second.config.nativeAlive = false
  second.presentation.layout(slot)
  assert.equal(second.manager.getStatus().state, 'error')
  second.presentation.dispose()
})

test('too-small work area rejects floating mode without terminating embedded video', () => {
  const { presentation, manager, events } = fixture({ x: 0, y: 0, width: 200, height: 180 })
  presentation.layout(slot)
  assert.throws(() => presentation.setMode('pip'), /yeterli masaüstü/)
  assert.equal(manager.getStatus().mode, 'embedded')
  assert.equal(events.filter(event => event[0] === 'present').length, 1)
  presentation.dispose()
})
