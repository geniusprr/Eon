import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { applicationPathKey, localExecutable } from '../ai/InstalledApplications.js'

export function inspectWindowsApplication(source: string): { target: string; args: string } | null {
  if (process.platform !== 'win32') return null
  try {
    const link = /\.lnk$/i.test(source) ? shell.readShortcutLink(source) : { target: source, args: '' }
    if (!localExecutable(link.target)) return null
    const target = fs.realpathSync.native(link.target)
    if (!localExecutable(target) || !fs.statSync(target).isFile()) return null
    return { target, args: link.args ?? '' }
  } catch {
    return null
  }
}

export function createWindowsShortcut(desktop: string, source: string, name: string) {
  if (/[<>:"/\\|?*\x00-\x1f]|[. ]$|^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) {
    throw new Error('Windows kısayolu için geçerli bir dosya adı kullanın.')
  }
  const expected = inspectWindowsApplication(source)
  if (!expected) throw new Error('Windows uygulamasının hedefi artık erişilebilir değil.')
  const filename = `${name}.lnk`
  const destination = path.join(desktop, filename)
  const temporary = fs.mkdtempSync(path.join(desktop, '.eon-shortcut-'))
  try {
    let link = source
    if (!/\.lnk$/i.test(source)) {
      link = path.join(temporary, filename)
      if (!shell.writeShortcutLink(link, { target: expected.target, cwd: path.dirname(expected.target) })) {
        throw new Error('Windows kısayolu yazılamadı.')
      }
    }
    try {
      fs.copyFileSync(link, destination, fs.constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = inspectWindowsApplication(destination)
      if (existing && applicationPathKey(existing.target) === applicationPathKey(expected.target) && existing.args === expected.args) {
        return { name: filename, created: false }
      }
      throw new Error(`Windows masaüstünde ${filename} zaten var. Başka bir kısayol adı kullanın.`)
    }
    return { name: filename, created: true }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}
