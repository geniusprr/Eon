import koffi from 'koffi'

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1
const MOUSEEVENTF_MOVE = 0x0001
const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_MIDDLEDOWN = 0x0020
const MOUSEEVENTF_MIDDLEUP = 0x0040
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_HWHEEL = 0x01000
const MOUSEEVENTF_ABSOLUTE = 0x8000
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79

const MOUSEINPUT = koffi.struct('KapanisMOUSEINPUT', {
  dx: 'long',
  dy: 'long',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
})
const KEYBDINPUT = koffi.struct('KapanisKEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
})
const HARDWAREINPUT = koffi.struct('KapanisHARDWAREINPUT', {
  uMsg: 'uint32_t',
  wParamL: 'uint16_t',
  wParamH: 'uint16_t',
})
const INPUT = koffi.struct('KapanisINPUT', {
  type: 'uint32_t',
  u: koffi.union({
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
    hi: HARDWAREINPUT,
  }),
})

const virtualKeys: Record<string, number> = {
  BACKSPACE: 0x08,
  TAB: 0x09,
  ENTER: 0x0d,
  SHIFT: 0x10,
  CTRL: 0x11,
  CONTROL: 0x11,
  ALT: 0x12,
  PAUSE: 0x13,
  CAPSLOCK: 0x14,
  ESC: 0x1b,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  ARROWLEFT: 0x25,
  UP: 0x26,
  ARROWUP: 0x26,
  RIGHT: 0x27,
  ARROWRIGHT: 0x27,
  DOWN: 0x28,
  ARROWDOWN: 0x28,
  PRINTSCREEN: 0x2c,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  RWIN: 0x5c,
  META: 0x5b,
  NUMLOCK: 0x90,
  SCROLLLOCK: 0x91,
  SEMICOLON: 0xba,
  EQUAL: 0xbb,
  COMMA: 0xbc,
  MINUS: 0xbd,
  PERIOD: 0xbe,
  SLASH: 0xbf,
  BACKQUOTE: 0xc0,
  BRACKETLEFT: 0xdb,
  BACKSLASH: 0xdc,
  BRACKETRIGHT: 0xdd,
  QUOTE: 0xde,
}

for (let index = 0; index < 26; index += 1) virtualKeys[String.fromCharCode(65 + index)] = 0x41 + index
for (let index = 0; index < 10; index += 1) virtualKeys[`DIGIT${index}`] = 0x30 + index
for (let index = 1; index <= 12; index += 1) virtualKeys[`F${index}`] = 0x6f + index

const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : null
const sendInput = user32?.func('unsigned int __stdcall SendInput(unsigned int cInputs, KapanisINPUT *pInputs, int cbSize)') as ((count: number, inputs: unknown[], size: number) => number) | undefined
const setCursorPos = user32?.func('bool __stdcall SetCursorPos(int x, int y)') as ((x: number, y: number) => boolean) | undefined
const getSystemMetrics = user32?.func('int __stdcall GetSystemMetrics(int nIndex)') as ((index: number) => number) | undefined

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeKey(code: string) {
  const value = code.trim().toUpperCase()
  if (value.startsWith('KEY') && value.length === 4) return value.slice(3)
  if (value.startsWith('DIGIT') && value.length === 6) return value
  return value
}

const mediaVirtualKeys = { previous: 0xb1, playPause: 0xb3, next: 0xb0, mute: 0xad, volumeDown: 0xae, volumeUp: 0xaf } as const

export class WindowsInputInjector {
  private display: DisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 }
  private readonly heldKeys = new Set<number>()
  private readonly heldButtons = new Set<'left' | 'right' | 'middle'>()

  setDisplay(display: DisplayBounds) {
    this.display = { ...display, width: Math.max(1, display.width), height: Math.max(1, display.height) }
  }

  move(x: number, y: number) {
    const screenX = Math.round(this.display.x + clamp(x, 0, 1) * (this.display.width - 1))
    const screenY = Math.round(this.display.y + clamp(y, 0, 1) * (this.display.height - 1))
    const virtualLeft = getSystemMetrics?.(SM_XVIRTUALSCREEN) ?? this.display.x
    const virtualTop = getSystemMetrics?.(SM_YVIRTUALSCREEN) ?? this.display.y
    const virtualWidth = Math.max(1, getSystemMetrics?.(SM_CXVIRTUALSCREEN) || this.display.width)
    const virtualHeight = Math.max(1, getSystemMetrics?.(SM_CYVIRTUALSCREEN) || this.display.height)
    const absoluteX = Math.round(clamp((screenX - virtualLeft) / Math.max(1, virtualWidth - 1), 0, 1) * 65_535)
    const absoluteY = Math.round(clamp((screenY - virtualTop) / Math.max(1, virtualHeight - 1), 0, 1) * 65_535)
    const sent = this.sendMouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0, absoluteX, absoluteY)
    return sent || Boolean(setCursorPos?.(screenX, screenY))
  }

  moveRelative(dx: number, dy: number) {
    const relativeX = Math.trunc(clamp(dx, -128, 128))
    const relativeY = Math.trunc(clamp(dy, -128, 128))
    if (relativeX === 0 && relativeY === 0) return true
    return this.sendMouse(MOUSEEVENTF_MOVE, 0, relativeX, relativeY)
  }

  button(button: 'left' | 'right' | 'middle', pressed: boolean) {
    const flags = button === 'left'
      ? (pressed ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP)
      : button === 'right'
        ? (pressed ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
        : (pressed ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP)
    const sent = this.sendMouse(flags, 0)
    if (sent) {
      if (pressed) this.heldButtons.add(button)
      else this.heldButtons.delete(button)
    }
    return sent
  }

  wheel(deltaX: number, deltaY: number) {
    const vertical = Math.trunc(clamp(deltaY, -20, 20) * 120)
    const horizontal = Math.trunc(clamp(deltaX, -20, 20) * 120)
    const verticalSent = vertical === 0 || this.sendMouse(MOUSEEVENTF_WHEEL, vertical)
    const horizontalSent = horizontal === 0 || this.sendMouse(MOUSEEVENTF_HWHEEL, horizontal)
    return verticalSent && horizontalSent
  }

  key(code: string, pressed: boolean) {
    const virtualKey = virtualKeys[normalizeKey(code)]
    if (!virtualKey) return false
    const sent = this.sendKeyboard(virtualKey, 0, pressed ? 0 : KEYEVENTF_KEYUP)
    if (sent) {
      if (pressed) this.heldKeys.add(virtualKey)
      else this.heldKeys.delete(virtualKey)
    }
    return sent
  }

  mediaKey(key: keyof typeof mediaVirtualKeys) {
    const virtualKey = mediaVirtualKeys[key]
    if (!virtualKey) return false
    return this.send([
      this.keyboardEvent(virtualKey, 0, KEYEVENTF_EXTENDEDKEY),
      this.keyboardEvent(virtualKey, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
    ])
  }

  text(value: string) {
    if (!value || value.length > 4_096) return false
    const events: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const scan = value.charCodeAt(index)
      events.push(this.keyboardEvent(0, scan, KEYEVENTF_UNICODE))
      events.push(this.keyboardEvent(0, scan, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))
    }
    return this.send(events)
  }

  releaseAll() {
    for (const key of this.heldKeys) this.sendKeyboard(key, 0, KEYEVENTF_KEYUP)
    for (const button of this.heldButtons) this.button(button, false)
    this.heldKeys.clear()
    this.heldButtons.clear()
  }

  private sendMouse(flags: number, mouseData: number, dx = 0, dy = 0) {
    return this.send([{
      type: INPUT_MOUSE,
      u: { mi: { dx, dy, mouseData, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }])
  }

  private sendKeyboard(virtualKey: number, scan: number, flags: number) {
    return this.send([this.keyboardEvent(virtualKey, scan, flags)])
  }

  private keyboardEvent(virtualKey: number, scan: number, flags: number) {
    return {
      type: INPUT_KEYBOARD,
      u: { ki: { wVk: virtualKey, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
  }

  private send(events: unknown[]) {
    if (!sendInput || !events.length) return false
    try {
      return sendInput(events.length, events, koffi.sizeof(INPUT)) === events.length
    } catch {
      return false
    }
  }
}
