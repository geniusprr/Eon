import koffi from 'koffi'

const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : null
const openInputDesktop = user32?.func('void * __stdcall OpenInputDesktop(uint32_t flags, bool inherit, uint32_t access)')
const closeDesktop = user32?.func('bool __stdcall CloseDesktop(void *desktop)')
const getDesktopInfo = user32?.func('bool __stdcall GetUserObjectInformationW(void *object, int index, void *info, uint32_t length, _Out_ uint32_t *needed)')
const DESKTOP_READOBJECTS = 0x0001
const UOI_NAME = 2
const nameBuffer = Buffer.alloc(256)
const bytesNeeded = [0]

export function isWindowsInteractiveDesktop(): boolean {
  if (!openInputDesktop || !closeDesktop || !getDesktopInfo) return false
  const desktop = openInputDesktop(0, false, DESKTOP_READOBJECTS)
  if (!desktop) return false
  try {
    return getDesktopInfo(desktop, UOI_NAME, nameBuffer, nameBuffer.length, bytesNeeded) &&
      nameBuffer.toString('utf16le', 0, Math.max(0, bytesNeeded[0] - 2)).toLowerCase() === 'default'
  } finally {
    closeDesktop(desktop)
  }
}
