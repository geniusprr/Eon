import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, FileDiff, ShieldCheck, Trash2 } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'

interface ConflictHead {
  revisionId: string
  title: string
  content: string
  deleted: boolean
  metadata: Record<string, unknown> | null
  parents: string[]
}
interface Conflict {
  noteId: string
  heads: ConflictHead[]
  pending: string[]
  reasons: Array<{ field: string; reason: string }>
  suggestedMerge?: { body: string | null; metadata: Record<string, unknown> | null; deleted: boolean }
}

async function invoke<T>(channel: IpcChannel, payload: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Çakışma çözümü yalnızca Eon Desktop içinde yapılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

export function ConflictResolver({ conflict, onResolved }: { conflict: Conflict; onResolved: () => Promise<void> }) {
  const [choice, setChoice] = useState(0)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftMetadata, setDraftMetadata] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heads = conflict.heads
  const unresolvedAncestry = conflict.pending.length > 0
  const pathCollision = conflict.reasons.some(reason => reason.reason === 'path-collision')

  useEffect(() => {
    const head = heads.find(item => !item.deleted) ?? heads[0]
    setChoice(Math.max(0, heads.indexOf(head)))
    setDraftTitle(head?.title ?? '')
    setDraftBody(head?.content ?? '')
    setDraftMetadata(head?.metadata ?? {})
    setError(null)
  }, [conflict.noteId, heads.map(head => head.revisionId).join(',')])

  const selectHead = (index: number) => {
    const head = heads[index]
    if (!head) return
    setChoice(index)
    setDraftTitle(head.title)
    setDraftBody(head.content)
    setDraftMetadata(head.metadata ?? {})
  }

  const suggest = () => {
    const merge = conflict.suggestedMerge
    if (!merge || merge.deleted) return
    setDraftTitle(typeof merge.metadata?.title === 'string' ? merge.metadata.title : draftTitle)
    setDraftBody(merge.body ?? '')
    setDraftMetadata(merge.metadata ?? {})
  }

  const resolve = async (deleted: boolean) => {
    if (busy || unresolvedAncestry) return
    if (!deleted && pathCollision && (!draftMetadata.path || typeof draftMetadata.path !== 'string')) {
      setError('Dosya yolu çakışması için farklı bir yol belirlemelisin.')
      return
    }
    setBusy(true); setError(null)
    try {
      const resolution = deleted ? { deleted: true }
        : { title: draftTitle.slice(0, 256), content: draftBody, metadata: draftMetadata }
      await invoke('eon2:notes:resolve', {
        noteId: conflict.noteId,
        expectedHeads: heads.map(head => head.revisionId).sort(),
        resolution,
      })
      await onResolved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Çakışma çözümü kaydedilemedi.') }
    finally { setBusy(false) }
  }

  return <div className="eon2-conflict-workspace" role="region" aria-label="Not sürüm çakışması">
    <div className="eon2-conflict-banner"><AlertTriangle size={20}/><div><strong>{heads.length > 1 ? 'Bu not için birden fazla sürüm bulundu' : 'Bu not başka bir notla aynı dosya yolunu kullanıyor'}</strong><p>Özgün içerik ve sürümler geçmişte korunacak. Çözüm yeni bir revizyon oluşturur.</p></div></div>
    {unresolvedAncestry && <p className="eon2-error" role="alert">{conflict.pending.length} revizyonun ataları henüz gelmedi. İkinci cihazdan eşitleme tamamlanmadan seçim yapılamaz.</p>}
    {heads.length === 0 && <p className="eon2-error">Sürüm geçmişi tamamlanmamış. İki cihazı yeniden bağla.</p>}
    <div className="eon2-conflict-heads">{heads.map((head, index) => <button className={`eon2-conflict-head ${choice === index ? 'is-selected' : ''}`} type="button" onClick={() => selectHead(index)} key={head.revisionId}>
      <span><FileDiff size={16}/> Sürüm {index + 1} {head.deleted && '· Silindi'}</span>
      <strong>{head.title}</strong>
      <small>{head.revisionId.slice(0, 12)} · {head.parents.length} ata</small>
      <pre>{head.deleted ? '[Silme işlemi]' : head.content.slice(0, 2000)}</pre>
    </button>)}</div>
    <div className="eon2-conflict-edit-header"><strong>Çözüm düzenleyici</strong><span>İçeriği inceleyip değiştirebilirsin.</span></div>
    <input className="eon2-conflict-title" aria-label="Çözülecek not başlığı" value={draftTitle} onChange={event => setDraftTitle(event.target.value)}/>
    {pathCollision && <label className="eon2-conflict-path-label">Dosya yolu çakışmasını gider
      <input className="eon2-conflict-title" aria-label="Çakışması çözülen yeni dosya yolu" value={typeof draftMetadata.path === 'string' ? draftMetadata.path : ''} onChange={event => setDraftMetadata(previous => ({ ...previous, path: event.target.value }))} placeholder={`Notes/${conflict.noteId}.md`}/>
      <small>Notların ayrı dosya yollarına sahip olması gerekir. Örn. <code>Notes/{conflict.noteId}.md</code></small>
    </label>}
    <textarea className="eon2-conflict-body" aria-label="Çözülecek not içeriği" value={draftBody} onChange={event => setDraftBody(event.target.value)}/>
    {error && <div className="eon2-error" role="alert">{error}</div>}
    <div className="eon2-conflict-actions">
      {conflict.suggestedMerge && !conflict.suggestedMerge.deleted && <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={suggest}><ArrowLeftRight size={15}/> Önerilen birleşimi incele</button>}
      {heads.some(head => head.deleted) && <button type="button" className="eon2-button eon2-button--outline" disabled={busy || unresolvedAncestry} onClick={() => void resolve(true)}><Trash2 size={14}/> Silme kararını uygula</button>}
      <button type="button" className="eon2-button eon2-button--primary" disabled={busy || unresolvedAncestry || heads.length < 1} onClick={() => void resolve(false)}><Check size={15}/> Çözümü kaydet</button>
    </div><div className="eon2-conflict-footer"><ShieldCheck size={15}/> Özgün sürümler geçmişte saklanır; çözüm iki başlığı tek revizyonda birleştirir.</div>
  </div>
}
