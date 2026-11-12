import type { WindowsInputInjector } from '../../WindowsInputInjector.js'

type RemoteInput = (input: WindowsInputInjector) => boolean
type MouseButton = 'left' | 'right' | 'middle'

const keys = /^(?:[A-Z]|DIGIT[0-9]|F(?:[1-9]|1[0-2])|BACKSPACE|TAB|ENTER|SHIFT|CTRL|ALT|ESC|SPACE|PAGEUP|PAGEDOWN|END|HOME|LEFT|UP|RIGHT|DOWN|INSERT|DELETE|META)$/

export function parseRemoteInput(value: unknown): RemoteInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('Geçersiz giriş paketi.')
  return value.map(parseEvent)
}

function parseEvent(value: unknown): RemoteInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz giriş.')
  const event = value as Record<string, unknown>
  if (event.type === 'release') return input => input.releaseAll()
  if (event.type === 'text' && typeof event.text === 'string' && event.text.length > 0 && event.text.length <= 256) {
    const text = event.text
    return input => input.text(text)
  }
  if (event.type === 'keys' && Array.isArray(event.keys) && event.keys.length >= 1 && event.keys.length <= 4 &&
    event.keys.every(key => typeof key === 'string' && keys.test(key)) && new Set(event.keys).size === event.keys.length) {
    const chord = event.keys as string[]
    return input => {
      let ok = true
      const pressed: string[] = []
      for (const key of chord) {
        if (!input.key(key, true)) { ok = false; break }
        pressed.push(key)
      }
      for (const key of pressed.reverse()) if (!input.key(key, false)) ok = false
      return ok
    }
  }
  const { x, y, button, action, dx, dy } = event
  if (event.type === 'relative' && typeof dx === 'number' && typeof dy === 'number' &&
    Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) <= 128 && Math.abs(dy) <= 128) {
    return input => input.moveRelative(dx, dy)
  }
  if (event.type === 'button' && (button === 'left' || button === 'right')) {
    if (action === 'down' || action === 'up') return input => input.button(button, action === 'down')
    if (action === 'click') return input => input.button(button, true) && input.button(button, false)
  }
  if (event.type === 'wheel' && typeof dx === 'number' && typeof dy === 'number' &&
    Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) <= 8 && Math.abs(dy) <= 8) {
    return input => input.wheel(dx, dy)
  }
  if (typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    if (event.type === 'move') return input => input.move(x, y)
    if (event.type === 'pointer' && (button === 'left' || button === 'right' || button === 'middle') &&
      (action === 'down' || action === 'up' || action === 'click')) {
      const mouse: MouseButton = button
      return input => {
        const moved = input.move(x, y)
        if (action === 'up') return input.button(mouse, false) && moved
        if (!moved || !input.button(mouse, true)) return false
        return action === 'down' || input.button(mouse, false)
      }
    }
  }
  throw new Error('Geçersiz giriş.')
}
