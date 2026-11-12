import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  AppWindow, Ban, Command, FileText, FolderOpen, LockKeyhole, Play,
  Plus, Power, RotateCw, Save, ShieldCheck, Terminal, Trash2, X,
  type LucideIcon,
} from 'lucide-react'
import type { IpcChannel } from '../../../shared/contracts'
import type { PcAction, PcActionKind } from '../../../shared/eon-controls'
import { actionIsPower, actionLabels, actionRequiresTarget, actionSummary, newAction, prepareAction } from './actionForm'
import { cancelScheduledPower } from './actionRegistry'
import { actionIcons, customActionIcon } from './actionIcons'
import { actionIconIds } from '../../../shared/eon-controls'
import './action-editor.css'

type TimerState = { action: 'shutdown' | 'restart'; targetAt: number }
type ActionList = { actions: PcAction[]; timer: TimerState | null }

const icons: Record<PcActionKind, LucideIcon> = {
  application: AppWindow,
  file: FileText,
  command: Terminal,
  lock: LockKeyhole,
  shutdown: Power,
  restart: RotateCw,
  cancel: Ban,
}

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('PC kontrolleri yalnızca Eon masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı.'
}

export function ActionsPane({ droppedPaths, clearDrop }: { droppedPaths?: string[]; clearDrop: () => void }) {
  const [actions, setActions] = useState<PcAction[]>([])
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [draft, setDraft] = useState<PcAction | null>(null)
  const [iconSearch, setIconSearch] = useState('')
  const [draggingFile, setDraggingFile] = useState(false)
  const [imported, setImported] = useState(false)
  const [argsText, setArgsText] = useState('[]')
  const [editorError, setEditorError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const mountedRef = useRef(false)
  const editingRef = useRef(false)
  const operationRef = useRef(false)
  const requestRef = useRef(0)
  const busy = pending !== null

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    const data = await invoke<ActionList>('eon2:actions:list')
    // An in-flight poll must never overwrite a newer mutation or a newer poll.
    if (!mountedRef.current || request !== requestRef.current || operationRef.current) return
    setActions(data.actions)
    setTimer(data.timer)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const poll = async () => {
      if (document.hidden || operationRef.current) return
      try { await reload() }
      catch (error) {
        if (mountedRef.current && !operationRef.current) setMessage({ text: errorText(error), error: true })
      }
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 5000)
    return () => {
      mountedRef.current = false
      ++requestRef.current
      window.clearInterval(interval)
    }
  }, [reload])

  useEffect(() => {
    if (!draft) return
    const element = dialogRef.current
    if (element && !element.open) element.showModal()
    return () => { if (element?.open) element.close() }
  }, [draft?.id])

  const openEditor = useCallback((action: PcAction) => {
    if (operationRef.current) return
    setIconSearch('')
    setImported(false)
    editingRef.current = true
    setDraft({ ...action, arguments: [...action.arguments] })
    setArgsText(JSON.stringify(action.arguments))
    setEditorError(null)
  }, [])

  const closeEditor = () => {
    if (operationRef.current) return
    editingRef.current = false
    setDraft(null)
    setEditorError(null)
  }

  const runOperation = async (
    key: string,
    work: () => Promise<unknown>,
    success: string,
    showError: (error: string) => void = error => setMessage({ text: error, error: true }),
  ): Promise<boolean> => {
    if (operationRef.current) return false
    operationRef.current = true
    ++requestRef.current
    setPending(key)
    setMessage(null)
    let completed = false
    try {
      await work()
      completed = true
      setMessage({ text: success, error: false })
    } catch (error) {
      showError(errorText(error))
    } finally {
      operationRef.current = false
      try { await reload() }
      catch (error) { setMessage({ text: `Liste yenilenemedi: ${errorText(error)}`, error: true }) }
      if (mountedRef.current) setPending(null)
    }
    return completed
  }

  const pickApplication = async () => {
    if (operationRef.current) return
    operationRef.current = true
    setPending('pick')
    setEditorError(null)
    try {
      const picked = await invoke<string | null>('eon2:actions:pick-app')
      if (picked) {
        const file = await invoke<Pick<PcAction, 'name' | 'target' | 'kind'>>('eon2:actions:drop', { paths: [picked] })
        setDraft(current => current ? { ...current, ...file, arguments: [] } : current)
        setArgsText('[]')
        setImported(true)
      }
    } catch (error) { setEditorError(errorText(error)) }
    finally {
      operationRef.current = false
      if (mountedRef.current) setPending(null)
    }
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || operationRef.current) return
    let action: PcAction
    try { action = prepareAction(draft, argsText) }
    catch (error) { setEditorError(errorText(error)); return }
    setEditorError(null)
    const saved = await runOperation('save', () => invoke('eon2:actions:save', action),
      `“${action.name}” kaydedildi.`, error => setEditorError(error))
    if (saved) closeEditor()
  }

  const execute = (action: PcAction) => {
    const needsConfirmation = action.kind === 'command' || actionIsPower(action.kind)
    if (needsConfirmation) {
      const details = action.kind === 'command' ? '\n\nPowerShell komutu bilgisayarda çalıştırılacak.'
        : action.kind === 'shutdown' || action.kind === 'restart' ? `\n\n${action.delaySeconds} saniye sonra uygulanacak.`
          : action.kind === 'lock' ? '\n\nOturum hemen kilitlenecek.' : ''
      if (!window.confirm(`“${action.name}” çalıştırılsın mı?${details}`)) return
    }
    void runOperation(action.id, () => invoke('eon2:actions:execute', { id: action.id }),
      `“${action.name}” eylemi çalıştırıldı.`)
  }

  const cancelTimer = () => {
    if (!window.confirm('Planlanmış Windows güç işlemi iptal edilsin mi?')) return
    void runOperation('cancel-timer', () => cancelScheduledPower(actions, invoke),
      'Planlanmış güç işlemi iptal edildi.')
  }

  const importPaths = useCallback(async (paths: string[]) => {
    if (operationRef.current) return
    operationRef.current = true
    setPending('import')
    setEditorError(null)
    try {
      const file = await invoke<Pick<PcAction, 'name' | 'target' | 'kind'>>('eon2:actions:drop', { paths })
      if (!mountedRef.current) return
      editingRef.current = true
      setDraft(current => ({ ...(current ?? newAction()), ...file, arguments: [], delaySeconds: 0 }))
      setArgsText('[]')
      setImported(true)
    } catch (error) {
      if (editingRef.current) setEditorError(errorText(error))
      else setMessage({ text: errorText(error), error: true })
    } finally {
      operationRef.current = false
      if (mountedRef.current) setPending(null)
    }
  }, [])

  useEffect(() => {
    if (!droppedPaths?.length) return
    void importPaths(droppedPaths)
    clearDrop()
  }, [droppedPaths, clearDrop, importPaths])

  const PreviewIcon = draft ? customActionIcon(draft.icon) ?? icons[draft.kind] : AppWindow

  return <>
    <div className="eon2-section-heading">
      <div>
        <h1>Kısayollar ve güç</h1>
        <p>Uygulamaları ve dosyaları tek dokunuşla aç. Telefon kontrol panelindeki tuşlar burada onayladığın eylemleri kullanır.</p>
      </div>
      <button type="button" className="eon2-button eon2-button--primary" disabled={busy} onClick={() => openEditor(newAction())}>
        <Plus size={16} aria-hidden="true"/> Kısayol ekle
      </button>
    </div>

    {message && <p className={message.error ? 'eon2-error' : 'eon2-pairing-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {timer && <div className="eon2-connection-banner eon2-action-timer">
      <span className="eon2-connection-icon"><Power size={20} aria-hidden="true"/></span>
      <div>
        <strong>{timer.action === 'shutdown' ? 'Bilgisayar kapatma' : 'Yeniden başlatma'} planlandı</strong>
        <p>{new Date(timer.targetAt).toLocaleString('tr-TR')} · Windows zamanlayıcısı etkin</p>
      </div>
      <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={cancelTimer}>
        <Ban size={15} aria-hidden="true"/> {pending === 'cancel-timer' ? 'İptal ediliyor…' : 'Planı iptal et'}
      </button>
    </div>}

    <div className="eon2-panel-heading eon2-action-toolbar">
      <h2>Tanımlı kısayollar</h2>
      <span className="eon2-quiet-label">{actions.length} eylem · Telefonda açılması için cihaz izni de gerekli</span>
    </div>
    {!actions.length && <div className="eon2-empty eon2-action-empty">
      <Command size={25} aria-hidden="true"/>
      <strong>Henüz kısayol tanımlanmadı</strong>
      <p>Uygulama, dosya, PowerShell komutu veya güç eylemi ekleyebilirsin.</p>
      <button type="button" className="eon2-button eon2-button--outline" onClick={() => openEditor(newAction())}>İlk kısayolu ekle</button>
    </div>}
    <div className="eon2-action-grid" aria-busy={busy}>
      {actions.map(action => {
        const Icon = customActionIcon(action.icon) ?? icons[action.kind]
        return <article className={`eon2-control-card ${pending === action.id ? 'eon2-control-card--pending' : ''}`} key={action.id}>
          <div className="eon2-control-card-title">
            <Icon size={21} strokeWidth={1.8} aria-hidden="true"/>
            <span className={`eon2-chip ${action.remoteEnabled ? 'eon2-chip--mint' : ''}`}>
              {action.remoteEnabled ? 'Telefona izinli' : 'Yalnızca PC'}
            </span>
          </div>
          <h2>{action.name}</h2>
          <p>{actionLabels[action.kind]}</p>
          <code className="eon2-action-target" title={actionSummary(action)}>{actionSummary(action)}</code>
          <div className="eon2-section-actions">
            <button type="button" className="eon2-button eon2-button--primary" disabled={busy} onClick={() => execute(action)}>
              <Play size={14} aria-hidden="true"/> {pending === action.id ? 'Çalışıyor…' : 'Çalıştır'}
            </button>
            <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={() => openEditor(action)}>Düzenle</button>
            <button type="button" className="eon2-button eon2-button--quiet" aria-label={`${action.name} kısayolunu sil`} disabled={busy} onClick={() => {
              if (window.confirm(`“${action.name}” kısayolu silinsin mi?`)) {
                void runOperation(`delete-${action.id}`, () => invoke('eon2:actions:delete', { id: action.id }),
                  `“${action.name}” silindi.`)
              }
            }}><Trash2 size={15} aria-hidden="true"/></button>
          </div>
        </article>
      })}
    </div>

    {draft && <dialog ref={dialogRef} className="eon2-control-editor" aria-labelledby="action-editor-title"
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault(); event.stopPropagation()
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
        setDraggingFile(!busy)
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false) }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation(); setDraggingFile(false)
        if (busy) return
        try {
          const paths = window.kapanisDesktop?.pathsForDroppedFiles?.(Array.from(event.dataTransfer.files))
          if (!paths?.length) throw new Error('Windows Gezgini’nden bir uygulama veya dosya bırak.')
          void importPaths(paths)
        } catch (error) { setEditorError(errorText(error)) }
      }}
      onCancel={event => { event.preventDefault(); closeEditor() }}>
      <form onSubmit={event => { void save(event) }}>
        <header>
          <h2 id="action-editor-title">{actions.some(action => action.id === draft.id) ? 'Kısayolu düzenle' : 'Yeni kısayol'}</h2>
          <button type="button" className="eon2-button eon2-button--quiet" aria-label="Düzenleyiciyi kapat" disabled={busy} onClick={closeEditor}><X size={18}/></button>
        </header>
        {editorError && <p className="eon2-error eon2-control-editor-error" role="alert">{editorError}</p>}
        <div className={`eon2-action-import ${draggingFile ? 'is-dragging' : ''}`} aria-busy={pending === 'import'}>
          <FolderOpen size={24} aria-hidden="true"/>
          <div><strong>{pending === 'import' ? 'Dosya algılanıyor…' : 'Uygulamanı buraya bırak'}</strong>
          <p>.exe, Windows kısayolu veya dosya. Adı ve eylemi otomatik dolduralım.</p></div>
        </div>
        {imported && <p className="eon2-action-detected" role="status"><ShieldCheck size={15}/> {actionLabels[draft.kind]} algılandı. Kaydetmeden önce düzenleyebilirsin.</p>}
        <div className="eon2-action-editor-body"><aside className="eon2-action-appearance">
        <div className="eon2-action-preview">
          <span><PreviewIcon size={30} strokeWidth={1.8} aria-hidden="true"/></span>
          <div><strong>{draft.name.trim() || 'Kısayolun'}</strong><small>{actionLabels[draft.kind]}</small></div>
        </div>
        <details className="eon2-icon-picker" open>
          <summary>Simge seç <span>Lucide · {draft.icon ? actionIcons[draft.icon].label : 'Otomatik'}</span></summary>
          <label className="eon2-icon-search">Simge ara
            <input type="search" value={iconSearch} placeholder="Oyun, müzik, kod…" disabled={busy} onChange={event => setIconSearch(event.target.value)}/>
          </label>
          <div className="eon2-icon-options" role="group" aria-label="Kısayol simgesi">
            <button type="button" className={!draft.icon ? 'is-selected' : ''} aria-pressed={!draft.icon} disabled={busy}
              onClick={() => setDraft({ ...draft, icon: undefined })} title="Eyleme göre otomatik"><Command size={21}/><span>Otomatik</span></button>
            {actionIconIds.filter(id => `${actionIcons[id].label} ${id}`.toLocaleLowerCase('tr').includes(iconSearch.toLocaleLowerCase('tr'))).map(id => {
              const option = actionIcons[id]
              const Icon = option.icon
              return <button type="button" key={id} className={draft.icon === id ? 'is-selected' : ''} aria-pressed={draft.icon === id}
                disabled={busy} onClick={() => setDraft({ ...draft, icon: id })} title={option.label}><Icon size={21} strokeWidth={1.8}/><span>{option.label}</span></button>
            })}
          </div>
        </details></aside><div className="eon2-action-fields">
        <label>Ad
          <input autoFocus required maxLength={80} value={draft.name} disabled={busy}
            placeholder="Örn. VS Code'u aç" onChange={event => { setEditorError(null); setDraft({ ...draft, name: event.target.value }) }}/>
        </label>
        <label>Eylem
          <select value={draft.kind} disabled={busy} onChange={event => {
            const kind = event.target.value as PcActionKind
            setEditorError(null)
            setArgsText('[]')
            setDraft({ ...draft, kind, target: '', arguments: [], delaySeconds: kind === 'shutdown' || kind === 'restart' ? 60 : 0 })
          }}>
            {Object.entries(actionLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select>
        </label>
        {actionRequiresTarget(draft.kind) && <>
          <label>{draft.kind === 'application' ? 'Uygulamanın tam yolu (.exe / .lnk)' : draft.kind === 'file' ? 'Dosyanın tam yolu' : 'PowerShell komutu'}
            <textarea required rows={draft.kind === 'command' ? 4 : 2} value={draft.target} disabled={busy} maxLength={4096}
              placeholder={draft.kind === 'application' ? 'C:\\Program Files\\Uygulama\\uygulama.exe' : draft.kind === 'file' ? 'C:\\Belgeler\\dosya.pdf' : 'Get-Process'}
              onChange={event => { setEditorError(null); setDraft({ ...draft, target: event.target.value }) }}/>
          </label>
          {draft.kind === 'application' && <>
            <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={() => { void pickApplication() }}>
              <FolderOpen size={15} aria-hidden="true"/> {pending === 'pick' ? 'Seçiliyor…' : 'Uygulama seç'}
            </button>
            <details className="eon2-action-advanced"><summary>Gelişmiş seçenekler</summary>
            <label>Argümanlar (JSON dizisi)
              <input value={argsText} disabled={busy} placeholder='["--help"]'
                onChange={event => { setEditorError(null); setArgsText(event.target.value) }}/>
            </label></details>
          </>}
          {draft.kind === 'command' && <p className="eon2-quiet-label eon2-action-warning">
            PowerShell komutu bilgisayarda çalışır. İşlem süresi 30 saniyeyle sınırlıdır; çıktısı panelde gösterilmez.
          </p>}
        </>}
        {(draft.kind === 'shutdown' || draft.kind === 'restart') && <label>Gecikme (saniye · en fazla 7 gün)
          <input type="number" required min={1} max={604800} step={1} value={draft.delaySeconds} disabled={busy}
            onChange={event => { setEditorError(null); setDraft({ ...draft, delaySeconds: event.target.value === '' ? NaN : Number(event.target.value) }) }}/>
        </label>}
        <label className="eon2-checkbox">
          <input type="checkbox" checked={draft.remoteEnabled} disabled={busy}
            onChange={event => setDraft({ ...draft, remoteEnabled: event.target.checked })}/>
          <span>Bu kısayolun telefondan çalıştırılmasına izin ver</span>
        </label>
        <p className="eon2-quiet-label"><ShieldCheck size={14} aria-hidden="true"/>
          {actionIsPower(draft.kind) ? ' Telefon için Cihazlar bölümünde “Güç” izni de gerekli.' : ' Telefon için Cihazlar bölümünde “Kısayollar” izni de gerekli.'}
          {' '}Telefonda düzenlenen bir eylem yeniden PC onayı ister.
        </p></div></div>
        <div className="eon2-section-actions">
          <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={closeEditor}>Vazgeç</button>
          <button type="submit" className="eon2-button eon2-button--primary" disabled={busy}>
            <Save size={15} aria-hidden="true"/> {pending === 'save' ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </dialog>}
  </>
}
