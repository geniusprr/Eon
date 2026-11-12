import type { AppTheme } from '../../../src/theme.js'

const themes: Record<string, AppTheme> = {
  açık: 'light', aydınlık: 'light', beyaz: 'light', koyu: 'obsidian', karanlık: 'obsidian',
  obsidian: 'obsidian', 'gün batımı': 'rose', 'mor aurora': 'violet', okyanus: 'ocean',
}

export function readLocalCommand(content: string) {
  if (/[\r\n]/.test(content)) return
  const text = content.normalize('NFC').replace(/[ \t]+/g, ' ').replace(/[.!]+$/, '')
    .replace(/^lütfen /iu, '').replace(/ lütfen$/iu, '')
  const themeText = text.toLocaleLowerCase('tr')
  const theme = /^(?:temayı (.+?) (?:yap|ayarla)|(.+?) temaya geç|(.+?) temayı (?:aç|etkinleştir))$/.exec(themeText)
  const themeName = theme?.slice(1).find(Boolean)
  if (themeName && Object.hasOwn(themes, themeName)) return { kind: 'theme' as const, theme: themes[themeName] }

  const shortcut = /^(?:(Windows masaüstüne|masaüstüne|Eon’a|Eon'a) )?([\p{L}\p{N}][\p{L}\p{N} .+&_-]{0,79}?) (?:için )?kısayol(?:u|unu)? (?:oluştur|ekle)$/iu.exec(text)
  if (!shortcut || /\b(?:ve|veya|sonra|ile|ama|için)\b/iu.test(shortcut[2])) return
  return { kind: 'shortcut' as const, application: shortcut[2].trim(),
    destination: shortcut[1]?.toLocaleLowerCase('tr').includes('masaüstüne') ? 'windows-desktop' as const : 'eon' as const }
}
