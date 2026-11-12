import type { PcAction, PcActionKind } from '../../../shared/eon-controls'

export const actionLabels: Record<PcActionKind, string> = {
  application: 'Uygulama aç',
  file: 'Dosya aç',
  command: 'PowerShell komutu',
  lock: 'Windows’u kilitle',
  shutdown: 'Bilgisayarı kapat',
  restart: 'Yeniden başlat',
  cancel: 'Güç planını iptal et',
}

export const actionRequiresTarget = (kind: PcActionKind) =>
  kind === 'application' || kind === 'file' || kind === 'command'

export const actionIsPower = (kind: PcActionKind) =>
  kind === 'lock' || kind === 'shutdown' || kind === 'restart' || kind === 'cancel'

export function newAction(kind: PcActionKind = 'application'): PcAction {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind,
    target: '',
    arguments: [],
    delaySeconds: kind === 'shutdown' || kind === 'restart' ? 60 : 0,
    remoteEnabled: true,
  }
}

/** Keep validation in step with PcActions.parseAction, which remains authoritative. */
export function prepareAction(draft: PcAction, argumentsText: string): PcAction {
  const name = draft.name.trim()
  if (!name || name.length > 80) throw new Error('Kısayol adı 1–80 karakter olmalı.')
  const target = actionRequiresTarget(draft.kind) ? draft.target.trim() : ''
  if (target.length > 4096 || target.includes('\0')) throw new Error('Komut veya yol geçersiz (en fazla 4096 karakter).')
  if (draft.kind === 'application' && (!/^[A-Za-z]:[\\/]/.test(target) && !/^\\\\[^\\]+\\[^\\]+/.test(target) || !/\.(exe|lnk)$/i.test(target))) {
    throw new Error('Uygulamanın Windows tam yolunu (.exe veya .lnk) gir veya dosyadan seç.')
  }
  if (draft.kind === 'file' && !/^[A-Za-z]:[\\/]/.test(target)) throw new Error('Yerel dosyanın tam yolunu gir (ör. C:\\Belgeler\\dosya.pdf).')
  if (draft.kind === 'command' && !target) throw new Error('Çalıştırılacak PowerShell komutunu gir.')

  let args: string[] = []
  if (draft.kind === 'application') {
    let parsed: unknown
    try { parsed = JSON.parse(argumentsText) }
    catch { throw new Error('Argümanları JSON metin dizisi olarak gir (ör. ["--help"]).') }
    if (!Array.isArray(parsed) || parsed.length > 32 || parsed.some(item => typeof item !== 'string' || item.length > 2048 || item.includes('\0'))) {
      throw new Error('Argümanlar en fazla 32 kısa metinden oluşan JSON dizisi olmalı.')
    }
    args = parsed as string[]
    if (/\.lnk$/i.test(target) && args.length) throw new Error('Windows kısayolunun argümanlarını .lnk dosyasında düzenle; buradaki alanı [] bırak.')
  }
  if (!Number.isInteger(draft.delaySeconds) || draft.delaySeconds < 0 || draft.delaySeconds > 604800) {
    throw new Error('Gecikme 0–604800 arasında tam sayı olmalı.')
  }
  if ((draft.kind === 'shutdown' || draft.kind === 'restart') && draft.delaySeconds < 1) {
    throw new Error('Güç eylemi için en az 1 saniye gecikme gir.')
  }
  return {
    ...draft,
    name,
    target,
    arguments: args,
    delaySeconds: draft.kind === 'shutdown' || draft.kind === 'restart' ? draft.delaySeconds : 0,
  }
}

export function actionSummary(action: PcAction): string {
  if (action.kind === 'shutdown' || action.kind === 'restart') {
    return `${action.delaySeconds} saniye sonra uygulanır`
  }
  if (action.kind === 'lock') return 'Windows oturumunu hemen kilitler'
  if (action.kind === 'cancel') return 'Planlı kapatma / yeniden başlatmayı iptal eder'
  return action.target
}
