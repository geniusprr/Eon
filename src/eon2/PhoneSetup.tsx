import { useEffect, useRef, useState } from 'react'
import { Cable, Download, Link2, Smartphone, X } from 'lucide-react'

const steps = [
  { icon: Smartphone, title: 'USB hata ayıklamayı aç', detail: 'Android’de Ayarlar → Telefon hakkında bölümünde Derleme numarasına yedi kez dokun. Geliştirici seçeneklerinden USB hata ayıklamayı aç.' },
  { icon: Cable, title: 'Telefonu USB ile bağla', detail: 'Bir USB veri kablosu kullan. Telefonunun kilidini aç ve bu bilgisayar için USB hata ayıklama iznini onayla.' },
  { icon: Link2, title: 'Eon’u eşleştir', detail: 'Eon telefonda yüklü değilse otomatik kurulur. Telefonundaki kurulum isteğini onayla, ardından Eşleştir’e dokun.' },
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

type InstallState = { installed: boolean; available: boolean; progress?: { phase: 'checking' | 'installing' | 'error'; message?: string } | null }

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
    const timer = window.setInterval(() => { if (!document.hidden && !busy) void check() }, 2000)
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

  if ((!status || status.installed) && !message && !busy && !status?.progress) return null
  const preparing = busy || status?.progress?.phase === 'checking' || status?.progress?.phase === 'installing'
  return <div className="eon2-phone-install" aria-live="polite">
    {message && <span>{message}</span>}
    {!message && status?.progress?.phase === 'error' && <span>Otomatik kurulum tamamlanamadı: {status.progress.message} Telefonun kilidini ve kurulum iznini kontrol edip tekrar dene.</span>}
    {preparing && <span>Eon hazırlanıyor. Telefonundaki kurulum isteğini onayla.</span>}
    {status && (!status.installed || status.progress?.phase === 'error') && <button type="button" className="eon2-button eon2-button--primary" disabled={preparing || (!status.installed && !status.available)} onClick={() => void install()}>
      <Download size={15} aria-hidden="true"/>{preparing ? 'Eon hazırlanıyor…' : 'Tekrar dene'}
    </button>}
    {status && !status.available && !status.installed && <small>Bu masaüstü derlemesinde Android paketi yok.</small>}
  </div>
}
