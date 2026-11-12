import { useEffect, useRef, useState } from 'react'
import { Cable, Download, Link2, Smartphone, X } from 'lucide-react'

const steps = [
  { icon: Smartphone, title: 'USB hata ayıklamayı aç', detail: 'Android’de Ayarlar → Telefon hakkında bölümünde Derleme numarasına yedi kez dokun. Geliştirici seçeneklerinden USB hata ayıklamayı aç.' },
  { icon: Cable, title: 'Telefonu USB ile bağla', detail: 'Bir USB veri kablosu kullan. Telefonunun kilidini aç ve bu bilgisayar için USB hata ayıklama iznini onayla.' },
  { icon: Link2, title: 'Eon’u kur ve eşleştir', detail: 'Eon iki cihazda da açıkken birinden Eşleştir’e dokun. İsteği karşı cihazda kabul et.' },
]

export function PhoneSetupGuide({ onClose, onDevices }: { onClose: () => void; onDevices: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return <dialog ref={dialog} className="eon2-phone-guide" aria-labelledby="phone-guide-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <button type="button" className="eon2-button eon2-button--outline eon2-phone-guide-close" aria-label="Rehberi kapat" onClick={onClose}><X size={18}/></button>
    <span className="eon2-connection-icon"><Smartphone size={24}/></span>
    <h1 id="phone-guide-title">Telefonunu Eon’a bağla</h1>
    <ol>{steps.map(({ icon: Icon, title, detail }) => <li key={title}><Icon size={20} aria-hidden="true"/><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
    <div className="eon2-phone-guide-actions">
      <button type="button" className="eon2-button eon2-button--outline" onClick={onClose}>Daha sonra</button>
      <button type="button" className="eon2-button eon2-button--primary" onClick={onDevices}>Cihazları aç</button>
    </div>
  </dialog>
}

type InstallState = { installed: boolean; available: boolean }

export function PhoneInstall({ serial }: { serial: string }) {
  const [status, setStatus] = useState<InstallState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const desktop = window.kapanisDesktop
    if (!desktop) return
    let alive = true
    const check = async () => {
      try {
        const result = await desktop.invoke('eon2:mobile:status', { serial }) as InstallState
        if (alive) setStatus(result)
      } catch {
        if (alive) setStatus(null)
      }
    }
    void check()
    const timer = window.setInterval(() => { if (!document.hidden && !busy) void check() }, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [serial, busy])

  async function install() {
    const desktop = window.kapanisDesktop
    if (!desktop || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await desktop.invoke('eon2:mobile:install', { serial })
      setStatus({ installed: true, available: true })
      setMessage('Eon telefona kuruldu. Eşleştir’i seçerek devam edebilirsin.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Telefon kurulumu tamamlanamadı.')
    } finally { setBusy(false) }
  }

  if ((!status || status.installed) && !message && !busy) return null
  return <div className="eon2-phone-install" aria-live="polite">
    {message && <span>{message}</span>}
    {status && !status.installed && <button type="button" className="eon2-button eon2-button--primary" disabled={busy || !status.available} onClick={() => void install()}>
      <Download size={15} aria-hidden="true"/>{busy ? 'Eon kuruluyor…' : 'Eon’u kur'}
    </button>}
    {status && !status.available && !status.installed && <small>Bu masaüstü derlemesinde Android paketi yok.</small>}
  </div>
}
