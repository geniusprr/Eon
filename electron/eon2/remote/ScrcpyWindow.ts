import koffi from 'koffi'

export type WindowHandle = number | bigint
type Rect = { left: number; top: number; right: number; bottom: number }

function loadWin32() {
  if (process.platform !== 'win32') throw new Error('Telefon ekranı Windows üzerinde kullanılabilir.')
  const lib = koffi.load('user32.dll')
  koffi.struct('EonScrcpyRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
  return {
    find: lib.func('uintptr_t __stdcall FindWindowW(void *className, str16 title)') as (className: null, title: string) => WindowHandle,
    pid: lib.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *pid)') as (window: WindowHandle, pid: number[]) => number,
    getStyle: lib.func('int32_t __stdcall GetWindowLongW(uintptr_t window, int index)') as (window: WindowHandle, index: number) => number,
    setStyle: lib.func('int32_t __stdcall SetWindowLongW(uintptr_t window, int index, int32_t style)') as (window: WindowHandle, index: number, style: number) => number,
    setOwner: lib.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t window, int index, intptr_t owner)') as (window: WindowHandle, index: number, owner: WindowHandle) => WindowHandle,
    setParent: lib.func('uintptr_t __stdcall SetParent(uintptr_t window, uintptr_t parent)') as (window: WindowHandle, parent: WindowHandle) => WindowHandle,
    getParent: lib.func('uintptr_t __stdcall GetParent(uintptr_t window)') as (window: WindowHandle) => WindowHandle,
    getWindow: lib.func('uintptr_t __stdcall GetWindow(uintptr_t window, uint32_t command)') as (window: WindowHandle, command: number) => WindowHandle,
    isWindow: lib.func('bool __stdcall IsWindow(uintptr_t window)') as (window: WindowHandle) => boolean,
    rect: lib.func('bool __stdcall GetClientRect(uintptr_t window, _Out_ EonScrcpyRect *rect)') as (window: WindowHandle, rect: Rect) => boolean,
    show: lib.func('bool __stdcall ShowWindowAsync(uintptr_t window, int command)') as (window: WindowHandle, command: number) => boolean,
    place: lib.func('bool __stdcall SetWindowPos(uintptr_t window, uintptr_t after, int x, int y, int width, int height, uint32_t flags)') as
      (window: WindowHandle, after: WindowHandle, x: number, y: number, width: number, height: number, flags: number) => boolean,
  }
}

let win32: ReturnType<typeof loadWin32> | undefined
const api = () => win32 ??= loadWin32()
const GWL_STYLE = -16
const GWLP_HWNDPARENT = -8
const GW_OWNER = 4
const WS_POPUP = 0x80000000
const WS_CHILD = 0x40000000
const WS_OVERLAPPEDWINDOW = 0x00cf0000
const SW_HIDE = 0
const SWP_NOACTIVATE = 0x0010
const SWP_FRAMECHANGED = 0x0020
const SWP_SHOWWINDOW = 0x0040
const HWND_NOTOPMOST = BigInt.asUintN(64, -2n)
const HWND_TOPMOST = BigInt.asUintN(64, -1n)

export function findScrcpyWindow(title: string, processId: number): WindowHandle | null {
  const window = api().find(null, title)
  if (!window) return null
  const pid = [0]
  return api().pid(window, pid) && pid[0] === processId ? window : null
}

export function getClientSize(window: WindowHandle) {
  const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!api().rect(window, rect)) throw new Error('Pencere boyutu okunamadı.')
  return { width: rect.right - rect.left, height: rect.bottom - rect.top }
}

export function hideScrcpy(window: WindowHandle) { api().show(window, SW_HIDE) }
export function isScrcpyWindow(window: WindowHandle) { return api().isWindow(window) }

// Electron/Chromium uses a DirectComposition surface which covers cross-process
// child HWNDs even if those HWNDs are first in the sibling z-order. Retain the
// real SDL window as an owned top-level popup instead. The owner keeps it in
// Eon's z-order group; it still receives real scrcpy mouse/keyboard input.
export function presentScrcpy(window: WindowHandle, owner: WindowHandle | null, mode: 'embedded' | 'window' | 'pip') {
  if (!api().isWindow(window) || (owner && !api().isWindow(owner))) throw new Error('Telefon ekranı penceresi artık mevcut değil.')
  hideScrcpy(window)
  // It may still be parented by an older presentation or a preceding mode.
  // SetParent(0) removes WS_CHILD ancestry; GWLP_HWNDPARENT then sets *owner*.
  if (api().getParent(window)) api().setParent(window, 0)
  const currentStyle = api().getStyle(window, GWL_STYLE)
  const nextStyle = mode === 'window'
    ? ((currentStyle & ~WS_CHILD & ~WS_POPUP) | WS_OVERLAPPEDWINDOW)
    : ((currentStyle & ~WS_CHILD & ~WS_OVERLAPPEDWINDOW) | WS_POPUP)
  if (nextStyle !== currentStyle && !api().setStyle(window, GWL_STYLE, nextStyle)) {
    throw new Error('Telefon ekranı pencere stili ayarlanamadı.')
  }
  api().setOwner(window, GWLP_HWNDPARENT, owner ?? 0)
  if (BigInt(api().getWindow(window, GW_OWNER)) !== BigInt(owner ?? 0)) {
    throw new Error('Telefon ekranının pencere sahipliği ayarlanamadı.')
  }
}

export function placeScrcpy(window: WindowHandle, x: number, y: number, width: number, height: number, topmost = false) {
  if (!api().isWindow(window) || width < 1 || height < 1) throw new Error('Telefon ekranı konumlandırılamadı.')
  // Explicitly release topmost when returning from PiP, without activation.
  if (!api().place(window, topmost ? HWND_TOPMOST : HWND_NOTOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
    throw new Error('Telefon ekranı konumlandırılamadı.')
  }
}
