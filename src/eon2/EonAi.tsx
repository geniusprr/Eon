import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, ArrowUp, Bot, Check, ChevronDown, CircleAlert, ExternalLink, KeyRound, LoaderCircle, MessageSquarePlus, RefreshCw, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { IpcChannel } from '../../shared/contracts'
import './eon-ai.css'

type AgentState = { configured: boolean; model: string; models?: string[] }
type AgentReply = { reply: string; actions?: string[] }
type AgentModels = { models: string[] }
type CommandProposal = { id: string; name: string; command: string; expiresAt: number }
type Turn = { id: number; role: 'user' | 'assistant'; content: string; actions?: string[]; failed?: boolean }
type Thread = { id: number; title: string; turns: Turn[] }

const EMPTY_STATE: AgentState = { configured: false, model: '' }

async function agentInvoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Eon AI, masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı. Tekrar deneyin.'
}

export function useEonAiController() {
  const [agent, setAgent] = useState<AgentState>(EMPTY_STATE)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState('')
  const [threads, setThreads] = useState<Thread[]>([{ id: 1, title: 'Yeni sohbet', turns: [] }])
  const [threadId, setThreadId] = useState(1)
  const [busy, setBusy] = useState(false)
  const [initialising, setInitialising] = useState(true)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [pending, setPending] = useState<CommandProposal | null>(null)
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const nextId = useRef(2)
  const activeSend = useRef(false)

  const refreshModels = useCallback(async () => {
    if (!window.kapanisDesktop) return
    setModelsLoading(true)
    try {
      const result = await agentInvoke<AgentModels>('eon2:ai:models')
      setModels(result.models.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))
    } catch { /* The saved model remains usable without a live catalogue. */ }
    finally { setModelsLoading(false) }
  }, [])

  const refreshPending = useCallback(async () => {
    if (!window.kapanisDesktop) return
    try {
      const next = await agentInvoke<CommandProposal | null>('eon2:ai:pending')
      setPending(next)
    } catch { /* Pending proposal support may be unavailable in older desktop builds. */ }
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const state = await agentInvoke<AgentState>('eon2:ai:state')
        if (!alive) return
        setAgent(state)
        setModel(current => current || state.model)
        setModels(state.models ?? [])
        setError(null)
        if (state.configured) void refreshModels()
      } catch (cause) {
        if (alive) setError(describeError(cause))
      } finally { if (alive) setInitialising(false) }
    }
    void load()
    void refreshPending()
    return () => { alive = false }
  }, [refreshModels, refreshPending])

  const saveSettings = async (input: { apiKey?: string; clearApiKey?: boolean; model?: string }) => {
    const next = await agentInvoke<AgentState>('eon2:ai:configure', input)
    setAgent(next)
    setModel(next.model)
    setModels(next.models ?? [])
    setError(null)
    setSettingsOpen(false)
    if (next.configured) void refreshModels()
  }

  const connectAccount = async () => {
    const next = await agentInvoke<AgentState>('eon2:ai:connect')
    setAgent(next)
    setModel(next.model)
    setModels(next.models ?? [])
    setError(null)
    setSettingsOpen(false)
    if (next.configured) void refreshModels()
  }

  const decidePending = async (approved: boolean) => {
    if (!pending || pendingBusy) return
    setPendingBusy(true)
    setPendingError(null)
    setApprovalNotice(null)
    try {
      if (approved) {
        const saved = await agentInvoke<{ id: string; kind: string }>('eon2:ai:approve', { id: pending.id })
        if (!saved?.id || saved.kind !== 'command') throw new Error('Komut kısayolu kaydı doğrulanamadı.')
      } else {
        const result = await agentInvoke<{ ok: boolean }>('eon2:ai:reject', { id: pending.id })
        if (!result.ok) throw new Error('Komut önerisi bulunamadı veya onay süresi doldu.')
      }
      setPending(null)
      setApprovalNotice(approved ? `“${pending.name}” PC kısayolu kaydedildi.` : `“${pending.name}” kısayol önerisi reddedildi.`)
      await refreshPending()
    } catch (cause) {
      setPendingError(describeError(cause))
      await refreshPending()
    } finally { setPendingBusy(false) }
  }

  const newThread = () => {
    const id = nextId.current++
    setThreads(current => [{ id, title: 'Yeni sohbet', turns: [] }, ...current])
    setThreadId(id)
    setDraft('')
    setError(null)
  }

  const removeThread = (id: number) => {
    setThreads(current => {
      const remaining = current.filter(thread => thread.id !== id)
      if (remaining.length) {
        if (threadId === id) setThreadId(remaining[0].id)
        return remaining
      }
      const replacement = nextId.current++
      setThreadId(replacement)
      return [{ id: replacement, title: 'Yeni sohbet', turns: [] }]
    })
  }

  const send = async () => {
    const content = draft.trim()
    if (!content || activeSend.current) return
    if (!window.kapanisDesktop || !agent.configured) {
      setError(!window.kapanisDesktop ? 'Eon AI, masaüstü uygulamasında kullanılabilir.' : 'Başlamak için OpenRouter API anahtarını ayarlayın.')
      if (window.kapanisDesktop) setSettingsOpen(true)
      return
    }
    const selectedModel = model.trim() || agent.model
    if (!selectedModel) { setError('Önce kullanmak istediğiniz modeli seçin.'); return }
    activeSend.current = true
    setBusy(true)
    setError(null)
    setPendingError(null)
    setApprovalNotice(null)
    setDraft('')
    const activeId = threadId
    const history = threads.find(thread => thread.id === activeId)?.turns
      .filter(turn => !turn.failed)
      .slice(-12)
      .map(turn => ({ role: turn.role, content: turn.content.slice(0, 2_000) })) ?? []
    const turnId = nextId.current++
    setThreads(current => current.map(thread => thread.id === activeId ? {
      ...thread,
      title: thread.turns.length === 0 ? content.slice(0, 55) : thread.title,
      turns: [...thread.turns, { id: turnId, role: 'user', content }],
    } : thread))
    try {
      const response = await agentInvoke<AgentReply>('eon2:ai:send', { content, model: selectedModel, history })
      setThreads(current => current.map(thread => thread.id === activeId ? {
        ...thread,
        turns: [...thread.turns, { id: nextId.current++, role: 'assistant', content: response.reply, actions: response.actions }],
      } : thread))
    } catch (cause) {
      setThreads(current => current.map(thread => thread.id === activeId ? {
        ...thread,
        turns: [...thread.turns, { id: nextId.current++, role: 'assistant', content: describeError(cause), failed: true }],
      } : thread))
      setError(describeError(cause))
    } finally {
      await refreshPending()
      activeSend.current = false
      setBusy(false)
    }
  }

  return {
    agent, model, setModel, models, draft, setDraft, threads, threadId, setThreadId,
    busy, initialising, modelsLoading, error, setError, settingsOpen, setSettingsOpen,
    refreshModels, refreshPending, saveSettings, connectAccount, newThread, removeThread, send,
    pending, pendingBusy, pendingError, approvalNotice, decidePending,
  }
}

export type EonAiController = ReturnType<typeof useEonAiController>

function ModelPicker({ ai, compact = false }: { ai: EonAiController; compact?: boolean }) {
  const listId = useId()
  const needle = ai.model.trim().toLocaleLowerCase('en')
  // Filter the complete catalogue as the user types; rendering thousands of options is costly.
  const matching = ai.models.filter(value => value.toLocaleLowerCase('en').includes(needle)).slice(0, 100)
  return <label className={`eon-ai-model ${compact ? 'is-compact' : ''}`}>
    {!compact && <span>Model</span>}
    <input aria-label="OpenRouter model adı" list={listId} value={ai.model} onChange={event => ai.setModel(event.target.value)} onFocus={event => event.currentTarget.select()} placeholder="Model ara veya yaz" spellCheck={false}/>
    <ChevronDown size={14} aria-hidden="true"/>
    <datalist id={listId}>{matching.map(value => <option key={value} value={value}/>)}</datalist>
  </label>
}

function Composer({ ai, compact = false }: { ai: EonAiController; compact?: boolean }) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ai.send() }
  return <form className={`eon-ai-composer ${compact ? 'is-compact' : ''}`} onSubmit={handleSubmit}>
    {compact ? <>
      <Sparkles className="eon-ai-command-icon" size={17} aria-hidden="true"/>
      <input className="eon-ai-command-input" aria-label="Eon AI komutu" maxLength={24_000} value={ai.draft} onChange={event => ai.setDraft(event.target.value)} placeholder="Eon AI’ya bir görev ver…"/>
      <ModelPicker ai={ai} compact/>
      <button type="button" className="eon-ai-icon-button" title="OpenRouter ayarları" aria-label="OpenRouter ayarlarını aç" onClick={() => ai.setSettingsOpen(true)}><Settings2 size={16}/></button>
    </> :
      <textarea aria-label="Eon AI mesajı" rows={3} maxLength={24_000} value={ai.draft} onChange={event => ai.setDraft(event.target.value)} placeholder="Örneğin: Notlarımı aç, yeni bir PC kısayolu oluştur veya bana yardım et…" onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ai.send() }
      }}/>
    }
    <button type="submit" className="eon-ai-send" disabled={!ai.draft.trim() || ai.busy || ai.initialising} aria-label={ai.busy ? 'AI yanıtı bekleniyor' : 'Eon AI’ya gönder'}>
      {ai.busy ? <LoaderCircle size={17} className="eon-ai-spin" aria-hidden="true"/> : compact ? <ArrowUp size={18} aria-hidden="true"/> : <ArrowRight size={18} aria-hidden="true"/>}
      {!compact && <span>{ai.busy ? 'Yanıt bekleniyor' : 'Gönder'}</span>}
    </button>
  </form>
}

export function EonAiHome({ ai, onOpen }: { ai: EonAiController; onOpen: () => void }) {
  const current = ai.threads.find(thread => thread.id === ai.threadId)
  const lastReply = [...(current?.turns ?? [])].reverse().find(turn => turn.role === 'assistant')
  const status = ai.busy ? 'Eon düşünüyor ve işlemi gerçekleştiriyor…' : ai.error || ai.approvalNotice || (ai.pending ? 'Komut önerisi incelemeni bekliyor.' : lastReply?.content)
  return <section className="eon-ai-home" aria-label="Eon AI ile oluştur">
    {status && <button type="button" className="eon-ai-home-status" onClick={onOpen} title={status} aria-live="polite">{status.replace(/\s+/g, ' ')}</button>}
    <Composer ai={ai} compact/>
  </section>
}

export function EonAiWorkspace({ ai, snapshot, now }: { ai: EonAiController; snapshot: { cpu: { usagePercent: number | null }; memory: { usagePercent: number } } | null; now: Date }) {
  const current = ai.threads.find(thread => thread.id === ai.threadId) ?? ai.threads[0]
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [current?.turns.length, ai.busy])
  return <section className="eon-ai-workspace" aria-label="Eon AI sohbeti">
    <aside className="eon-ai-threads" aria-label="Bu oturumdaki konuşmalar">
      <button type="button" className="eon-ai-new" onClick={ai.newThread}><MessageSquarePlus size={16}/> Yeni sohbet</button>
      <div className="eon-ai-thread-list">{ai.threads.map(thread => <div key={thread.id} className={`eon-ai-thread ${thread.id === ai.threadId ? 'is-selected' : ''}`}>
        <button type="button" aria-current={thread.id === ai.threadId ? 'true' : undefined} title={thread.title} onClick={() => ai.setThreadId(thread.id)}>{thread.title}</button>
        <button type="button" aria-label={`${thread.title} sohbetini sil`} title="Sohbeti sil" onClick={() => ai.removeThread(thread.id)}><Trash2 size={14}/></button>
      </div>)}</div>
      <small>Konuşmalar bu uygulama oturumu boyunca tutulur.</small>
    </aside>
    <div className="eon-ai-chat">
      <header className="eon-ai-chat-header"><div><span className="eon-ai-eyebrow">AKILLI ÇALIŞMA ALANI</span><h1>Eon AI <span>· OpenRouter</span></h1></div>
        <div className="eon-ai-chat-actions"><button type="button" title="Modelleri yenile" onClick={() => void ai.refreshModels()} disabled={ai.modelsLoading}><RefreshCw size={17} className={ai.modelsLoading ? 'eon-ai-spin' : ''}/></button>
          <button type="button" onClick={() => ai.setSettingsOpen(true)}><Settings2 size={16}/> <span>Ayarlar</span></button></div>
      </header>
      <div className="eon-ai-chat-history" aria-live="polite" aria-relevant="additions text">
        <div className="eon-ai-widgets" aria-label="Canlı sistem bilgileri"><div><span>Saat</span><strong>{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</strong></div><div><span>CPU</span><strong>{snapshot?.cpu.usagePercent == null ? '—' : `%${Math.round(snapshot.cpu.usagePercent)}`}</strong></div><div><span>Bellek</span><strong>{snapshot?.memory.usagePercent == null ? '—' : `%${Math.round(snapshot.memory.usagePercent)}`}</strong></div></div>
        {current.turns.length === 0 && <div className="eon-ai-welcome"><span className="eon-ai-welcome-icon"><Bot size={30}/></span><h2>Nasıl yardımcı olabilirim?</h2><p>Eon'un uygulamalarını açabilir, kısayollarını ve Deck düzenini yönetmemi isteyebilir veya bir soru sorabilirsin.</p>
          <div className="eon-ai-suggestions"><button onClick={() => ai.setDraft('PC kısayollarımı göster ve düzenlememe yardım et.')}>Kısayollarımı yönet</button><button onClick={() => ai.setDraft('Deck ekranımı nasıl özelleştirebilirim?')}>Deck’i düzenle</button><button onClick={() => ai.setDraft('Eon Notes bölümünü aç.')}>Notları aç</button></div>
        </div>}
        {current.turns.map(turn => <article key={turn.id} className={`eon-ai-turn is-${turn.role} ${turn.failed ? 'is-error' : ''}`}>
          <div className="eon-ai-turn-avatar">{turn.role === 'assistant' ? <Bot size={17}/> : 'Sen'}</div>
          <div className="eon-ai-turn-body"><span className="eon-ai-turn-label">{turn.role === 'assistant' ? 'Eon AI' : 'Sen'}</span>
            {turn.role === 'assistant' && !turn.failed ? <div className="eon-ai-turn-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
              img: () => null,
            }}>{turn.content}</ReactMarkdown></div> : <p>{turn.content}</p>}
            {!!turn.actions?.length && <div className="eon-ai-actions"><strong>Araç sonuçları</strong>{turn.actions.map((action, index) => <span key={`${index}:${action}`} className={action.endsWith(': başarılı') ? '' : 'is-failed'}>{action.endsWith(': başarılı') ? <Check size={14}/> : <CircleAlert size={14}/>} {action}</span>)}</div>}
          </div>
        </article>)}
        {ai.busy && <div className="eon-ai-thinking" role="status"><LoaderCircle size={16} className="eon-ai-spin"/> Eon düşünüyor ve komutunu işliyor…</div>}
        <div ref={bottom}/>
      </div>
      {ai.pending && <section className="eon-ai-pending" aria-labelledby="eon-ai-pending-title">
        <div className="eon-ai-pending-header"><div><span>ONAY GEREKLİ</span><h2 id="eon-ai-pending-title">{ai.pending.name}</h2></div><KeyRound size={19} aria-hidden="true"/></div>
        <p>AI bir PC komut kısayolu önerdi. Aşağıdaki komut yalnızca sen onaylarsan kısayol olarak kaydedilir; kaydedilmesi komutu çalıştırmaz.</p>
        <pre aria-label="Kaydedilmesi önerilen tam komut">{ai.pending.command}</pre>
        {Number.isFinite(ai.pending.expiresAt) && <small>Onayın son geçerlilik saati: {new Date(ai.pending.expiresAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</small>}
        <div className="eon-ai-pending-actions"><button type="button" className="eon-ai-reject" onClick={() => void ai.decidePending(false)} disabled={ai.pendingBusy}>Reddet</button>
          <button type="button" className="eon-ai-approve" onClick={() => void ai.decidePending(true)} disabled={ai.pendingBusy}>{ai.pendingBusy ? <LoaderCircle size={15} className="eon-ai-spin"/> : <Check size={15}/>} İnceledim, kısayolu kaydet</button></div>
      </section>}
      {ai.pendingError && <p className="eon-ai-pending-result is-error" role="alert"><CircleAlert size={15}/>{ai.pendingError}</p>}
      {ai.approvalNotice && <p className="eon-ai-pending-result" role="status"><Check size={15}/>{ai.approvalNotice}</p>}
      <div className="eon-ai-chat-bottom"><div className="eon-ai-chat-controls"><ModelPicker ai={ai}/><span className={`eon-ai-connectivity ${ai.agent.configured ? 'is-configured' : ''}`}><span/>{ai.agent.configured ? 'OpenRouter bağlı' : 'API anahtarı gerekli'}</span></div>
        <Composer ai={ai}/>
        {ai.error && <p className="eon-ai-inline-error" role="alert"><CircleAlert size={14}/>{ai.error}</p>}
        <p className="eon-ai-disclaimer">AI işlem yapmadan önce komutunu kontrol et. Yanıtlar hatalı olabilir.</p>
      </div>
    </div>
  </section>
}

export function EonAiSettings({ ai }: { ai: EonAiController }) {
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  busyRef.current = saving || connecting
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        ai.setSettingsOpen(false)
      }
      if (event.key !== 'Tab') return
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus() }
  }, [ai.setSettingsOpen])
  if (!ai.settingsOpen) return null
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await ai.saveSettings({ ...(key.trim() ? { apiKey: key.trim() } : {}), ...(clearKey ? { clearApiKey: true } : {}), model: ai.model.trim() || ai.agent.model })
      setKey('')
      setClearKey(false)
    } catch (cause) { setError(describeError(cause)) }
    finally { setSaving(false) }
  }
  const connect = async () => {
    setConnecting(true)
    setError(null)
    try { await ai.connectAccount(); setKey(''); setClearKey(false) }
    catch (cause) { setError(describeError(cause)) }
    finally { setConnecting(false) }
  }
  return <div className="eon-ai-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving && !connecting) ai.setSettingsOpen(false) }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="eon-ai-dialog-title" className="eon-ai-dialog">
      <header><div className="eon-ai-settings-icon"><KeyRound size={21}/></div><div><h2 id="eon-ai-dialog-title">OpenRouter bağlantısı</h2><p>OpenRouter hesabını bağla veya API anahtarı ekle.</p></div><button ref={closeRef} type="button" aria-label="Ayarları kapat" onClick={() => ai.setSettingsOpen(false)} disabled={saving || connecting}><X size={19}/></button></header>
      <button type="button" className="eon-ai-account-connect" onClick={() => void connect()} disabled={saving || connecting}>
        {connecting ? <LoaderCircle size={18} className="eon-ai-spin"/> : <ExternalLink size={17}/>}
        <span>{connecting ? 'OpenRouter tarayıcı bağlantısı bekleniyor…' : 'OpenRouter hesabıyla bağlan'}</span>
        {!connecting && <ArrowRight size={17}/>}
      </button>
      <p className="eon-ai-method-divider">VEYA API ANAHTARIYLA</p>
      <form onSubmit={event => void save(event)}>
        <label>API anahtarı <span>{ai.agent.configured ? '· Kayıtlı anahtar mevcut' : '· Henüz yapılandırılmadı'}</span>
          <input type="password" autoComplete="off" disabled={connecting} value={key} onChange={event => { setKey(event.target.value); setClearKey(false) }} placeholder={ai.agent.configured ? 'Değiştirmek için yeni anahtar gir' : 'sk-or-v1-…'} spellCheck={false}/>
        </label>
        <label className="eon-ai-clear"><input type="checkbox" disabled={connecting} checked={clearKey} onChange={event => { setClearKey(event.target.checked); if (event.target.checked) setKey('') }}/><span>Kaydedilmiş API anahtarını kaldır</span></label>
        <ModelPicker ai={ai}/>
        <p className="eon-ai-key-note">Anahtarın masaüstü uygulamasında saklanır ve yanıt üretmek için OpenRouter'a gönderilir. Anahtar burada tekrar gösterilmez.</p>
        {error && <p role="alert" className="eon-ai-inline-error"><CircleAlert size={15}/>{error}</p>}
        <footer><button type="button" className="eon-ai-secondary" disabled={saving || connecting} onClick={() => ai.setSettingsOpen(false)}>Vazgeç</button><button type="submit" className="eon-ai-save" disabled={saving || connecting || (!key.trim() && !ai.agent.configured && !clearKey)}>{saving ? <LoaderCircle size={16} className="eon-ai-spin"/> : <Check size={16}/>} Kaydet</button></footer>
      </form>
    </section>
  </div>
}
