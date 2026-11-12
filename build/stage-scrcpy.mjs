import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Stage a complete official scrcpy Windows distribution for the Eon installer.
// scrcpy.exe alone cannot run: its server and codec/SDL DLLs are required.
const root = fileURLToPath(new URL('../', import.meta.url))
const configured = process.env.EON_SCRCPY_DIST_DIR
let source = configured && path.isAbsolute(configured) ? configured : null
if (!source && process.platform === 'win32') {
  try {
    const located = execFileSync('where.exe', ['scrcpy.exe'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      .split(/\r?\n/).map(value => value.trim())
      .find(value => path.isAbsolute(value) && path.basename(value).toLowerCase() === 'scrcpy.exe' && existsSync(value))
    if (located) source = path.dirname(located)
  } catch { /* A distribution directory can be supplied through EON_SCRCPY_DIST_DIR. */ }
}
if (!source) throw new Error('scrcpy dağıtımını bulamadım. EON_SCRCPY_DIST_DIR tam dizinini ayarla veya scrcpy.exe dosyasını PATH içine ekle.')

const required = ['scrcpy.exe', 'scrcpy-server', 'SDL2.dll', 'adb.exe']
for (const file of required) {
  if (!(await stat(path.join(source, file)).catch(() => null))?.isFile()) {
    throw new Error(`Eksik scrcpy dağıtım dosyası: ${file}`)
  }
}
const files = (await readdir(source)).filter(file => required.includes(file) || /^[-a-z0-9.]+\.dll$/i.test(file))
const destination = path.join(root, 'build', 'scrcpy')
await mkdir(destination, { recursive: true })
for (const file of files) await copyFile(path.join(source, file), path.join(destination, file))
console.log(`scrcpy dağıtımı paketlemeye hazır (${files.length} dosya).`)
