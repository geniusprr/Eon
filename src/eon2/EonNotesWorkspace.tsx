import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BookOpen, Check, ChevronDown, ChevronRight, Columns2, Download, Eye, FilePlus2, FileText, Folder, FolderOpen, FolderClosed, Hash, Link2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, Save, Search, ShieldCheck, Trash2, X, Bold, Italic, Heading2, List, ListTodo, Quote, Code2, Undo2, Redo2 } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import { ConflictResolver } from './ConflictResolver'
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownFormat } from './MarkdownEditor'
import './eon-notes.css'

type NoteHead = { revisionId: string; title: string; content: string; deleted: boolean; metadata: Record<string, unknown> | null; parents: string[] }
type NoteConflict = { noteId: string; heads: NoteHead[]; pending: string[]; reasons: Array<{ field: string; reason: string }>; suggestedMerge?: { body: string | null; metadata: Record<string, unknown> | null; deleted: boolean } }
export type WorkspaceNote = { id: string; title: string; content: string; revisionId: string; updatedAt: number; path?: string; deleted: boolean; unresolved?: boolean; conflict?: NoteConflict }
type Tab = { key: string; id: string | null; revisionId: string | null; title: string; body: string; path: string; savedTitle: string; savedBody: string; savedPath: string; error: string | null; stale: boolean }
type Tree = { name: string; path: string; folders: Map<string, Tree>; files: WorkspaceNote[] }
type Mode = 'edit' | 'split' | 'read'
type Panel = 'files' | 'search' | 'tags'
const MarkdownPreview = lazy(async () => ({ default: (await import('./MarkdownPreview')).MarkdownPreview }))

const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('tr-TR')
const safeName = (name: string) => name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/g, '').slice(0, 90) || 'Yeni not'
const notePath = (note: WorkspaceNote) => note.path || 'Notes/' + note.id + '.md'
const basename = (value: string) => value.split('/').pop()?.replace(/\.md$/i, '') || 'Başlıksız'
const dir = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : ''
const isDirty = (tab: Tab) => tab.title !== tab.savedTitle || tab.body !== tab.savedBody || tab.path !== tab.savedPath
const fromNote = (note: WorkspaceNote): Tab => ({ key: note.id, id: note.id, revisionId: note.revisionId, title: note.title, body: note.content, path: notePath(note), savedTitle: note.title, savedBody: note.content, savedPath: notePath(note), error: null, stale: false })
const links = (body: string) => [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match => match[1].trim())
const tags = (body: string) => [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => fold(match[1]))
const outlineOf = (body: string) => body.split(/\r?\n/).flatMap((line, index) => {
  const match = /^(#{1,6})\s+(.+)$/.exec(line)
  return match ? [{ level: match[1].length, title: match[2], line: index + 1 }] : []
})
function buildTree(notes: WorkspaceNote[]): Tree {
  const root: Tree = { name: '', path: '', folders: new Map(), files: [] }
  for (const note of notes) {
    let cursor = root
    for (const segment of notePath(note).replace(/\\/g, '/').split('/').slice(0, -1)) {
      let child = cursor.folders.get(segment)
      if (!child) {
        child = { name: segment, path: cursor.path ? cursor.path + '/' + segment : segment, folders: new Map(), files: [] }
        cursor.folders.set(segment, child)
      }
      cursor = child
    }
    cursor.files.push(note)
  }
  return root
}
async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Not işlemleri Eon masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}
const describeError = (error: unknown) => error instanceof Error ? error.message : 'Not işlemi tamamlanamadı.'

export function EonNotesWorkspace({ notes, refresh, active }: { notes: WorkspaceNote[]; refresh: () => Promise<void>; active: boolean }) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [panel, setPanel] = useState<Panel>('files')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [inspector, setInspector] = useState<'outline' | 'links'>('outline')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const inflight = useRef(new Set<string>())
  const editor = useRef<MarkdownEditorHandle>(null)
  const importFile = useRef<HTMLInputElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const current = tabs.find(tab => tab.key === selectedKey)
  const currentNote = notes.find(note => note.id === current?.id)
  const conflict = currentNote?.unresolved && currentNote.conflict ? currentNote.conflict : null
  const tree = useMemo(() => buildTree(notes), [notes])
  const matches = useMemo(() => notes.filter(note => (!tagFilter || tags(note.content).includes(tagFilter)) &&
    (!query || fold(note.title + ' ' + notePath(note) + ' ' + note.content).includes(fold(query)))), [notes, query, tagFilter])
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of notes) for (const tag of new Set(tags(note.content))) counts.set(tag, (counts.get(tag) || 0) + 1)
    return [...counts.entries()].sort(([a],[b]) => a.localeCompare(b,'tr-TR'))
  }, [notes])
  const outline = useMemo(() => outlineOf(current?.body || ''), [current?.body])
  const outgoing = useMemo(() => links(current?.body || ''), [current?.body])
  const backlinks = useMemo(() => current ? notes.filter(note => note.id !== current.id &&
    links(note.content).some(link => fold(link) === fold(current.title) || fold(link) === fold(basename(current.path)))) : [], [notes, current?.id, current?.title, current?.path])
  const patchTab = useCallback((key: string, patch: Partial<Tab>) =>
    setTabs(previous => previous.map(tab => tab.key === key ? { ...tab, ...patch } : tab)), [])
  const openNote = useCallback((note: WorkspaceNote) => {
    setTabs(previous => previous.some(tab => tab.id === note.id) ? previous : [...previous, fromNote(note)])
    setSelectedKey(note.id)
    setNotice(null)
  }, [])
  const newNote = useCallback((folder = 'Notlar') => {
    const parent = folder.split('/').map(safeName).filter(Boolean).join('/') || 'Notlar'
    const existing = new Set(notes.map(note => fold(notePath(note))))
    let path = parent + '/Yeni not.md'
    let index = 1
    while (existing.has(fold(path))) path = parent + '/Yeni not ' + (++index) + '.md'
    const key = 'draft-' + crypto.randomUUID()
    setTabs(previous => [...previous, { key, id: null, revisionId: null, title: 'Yeni not',
      body: '', path, savedTitle: '', savedBody: '', savedPath: path, error: null, stale: false }])
    setSelectedKey(key)
    setMode('edit')
  }, [notes])

  // Apply an immutable snapshot after the transaction. New typing while the IPC is pending stays intact.
  const saveTab = useCallback(async (key: string): Promise<boolean> => {
    const snapshot = tabsRef.current.find(tab => tab.key === key)
    if (!snapshot || !isDirty(snapshot)) return true
    if (snapshot.stale || inflight.current.has(key)) return false
    inflight.current.add(key)
    setSavingKey(key)
    patchTab(key, { error: null })
    try {
      const result = await invoke<WorkspaceNote>('eon2:notes:save', {
        ...(snapshot.id ? { id: snapshot.id, expectedRevisionId: snapshot.revisionId } : {}),
        title: snapshot.title.trim() || 'Başlıksız Not',
        content: snapshot.body, path: snapshot.path,
      })
      setTabs(previous => previous.map(tab => tab.key !== key ? tab : {
        ...tab, id: result.id, revisionId: result.revisionId,
        savedTitle: result.title, savedBody: result.content, savedPath: result.path ?? snapshot.path,
        title: tab.title === snapshot.title ? result.title : tab.title,
        body: tab.body === snapshot.body ? result.content : tab.body,
        path: tab.path === snapshot.path ? (result.path ?? snapshot.path) : tab.path,
        error: null, stale: false,
      }))
      await refresh()
      return true
    } catch (error) {
      patchTab(key, { error: describeError(error), stale: Boolean(snapshot.id) })
      return false
    } finally {
      inflight.current.delete(key)
      setSavingKey(value => value === key ? null : value)
    }
  }, [patchTab, refresh])
  const closeTab = useCallback(async (key: string) => {
    const tab = tabsRef.current.find(tab => tab.key === key)
    if (tab && isDirty(tab) && !(await saveTab(key))) { setSelectedKey(key); return }
    setTabs(previous => previous.filter(item => item.key !== key))
    setSelectedKey(value => value === key ? (tabsRef.current.find(tab => tab.key !== key)?.key ?? null) : value)
  }, [saveTab])

  // Remote USB/Tailscale revisions refresh the clean editor; unsaved local text remains visible.
  useEffect(() => {
    setTabs(previous => previous.map(tab => {
      if (!tab.id) return tab
      const remote = notes.find(note => note.id === tab.id)
      if (!remote || remote.revisionId === tab.revisionId) return tab
      return isDirty(tab) ? { ...tab, stale: true, error: 'Not farklı bir cihazda değişti. Taslağın korunuyor; kopya olarak kaydet veya yeni sürümü aç.' } : fromNote(remote)
    }))
  }, [notes])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const tab of tabsRef.current) {
        if (isDirty(tab) && !tab.stale && !tab.error && !inflight.current.has(tab.key) &&
            !notes.some(note => note.id === tab.id && note.unresolved)) void saveTab(tab.key)
      }
    }, 1100)
    return () => window.clearTimeout(timer)
  }, [tabs, notes, saveTab])
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'n') { event.preventDefault(); newNote() }
      else if (key === 's' && selectedKey) { event.preventDefault(); void saveTab(selectedKey) }
      else if (key === 'w' && selectedKey) { event.preventDefault(); void closeTab(selectedKey) }
      else if (key === 'o' || key === 'k' || (key === 'f' && event.shiftKey)) {
        event.preventDefault(); setLeftOpen(true); setPanel('search')
        window.requestAnimationFrame(() => searchField.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selectedKey, newNote, saveTab, closeTab])
  useEffect(() => {
    const onClose = (event: BeforeUnloadEvent) => {
      if (tabsRef.current.some(isDirty)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', onClose)
    return () => window.removeEventListener('beforeunload', onClose)
  }, [])

  const saveCopy = async () => {
    if (!current) return
    try {
      const result = await invoke<WorkspaceNote>('eon2:notes:save', {
        title: current.title + ' (kopya)', content: current.body,
        path: (dir(current.path) ? dir(current.path) + '/' : '') + safeName(current.title + ' (kopya)') + '.md',
      })
      setTabs(previous => [...previous.filter(tab => tab.key !== current.key), fromNote(result)])
      setSelectedKey(result.id)
      await refresh()
    } catch (error) { patchTab(current.key, { error: describeError(error) }) }
  }
  const deleteNote = async () => {
    if (!current?.id || !current.revisionId || conflict || !window.confirm('Not silinsin mi? Geçmiş korunacak.')) return
    if (isDirty(current) && !(await saveTab(current.key))) return
    const snapshot = tabsRef.current.find(tab => tab.key === current.key)
    if (!snapshot?.id || !snapshot.revisionId) return
    try {
      await invoke('eon2:notes:delete', { id: snapshot.id, expectedRevisionId: snapshot.revisionId })
      setTabs(previous => previous.filter(tab => tab.key !== snapshot.key))
      setSelectedKey(null)
      await refresh()
    } catch (error) { patchTab(current.key, { stale: true, error: describeError(error) }) }
  }
  const changePath = () => {
    if (!current) return
    const input = window.prompt('Markdown dosya yolu (ör. Projeler/Fikir.md)', current.path)
    if (input === null) return
    const path = input.trim().replace(/\\/g, '/')
    if (!path.toLowerCase().endsWith('.md') || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) {
      patchTab(current.key, { error: 'Güvenli bir göreli .md yolu kullan.' })
      return
    }
    patchTab(current.key, { path, error: null })
  }
  const exportNote = () => {
    if (!current) return
    const url = URL.createObjectURL(new Blob([current.body], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = safeName(current.title) + '.md'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importNotes = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    let count = 0
    const reserved = new Set(notes.map(note => fold(notePath(note))))
    try {
      for (const file of Array.from(files)) {
        if (!/\.(?:md|markdown)$/i.test(file.name)) continue
        const title = file.name.replace(/\.(?:md|markdown)$/i,'').slice(0,256)
        let path = 'Notlar/' + safeName(title) + '.md'
        let suffix = 1
        while (reserved.has(fold(path))) path = 'Notlar/' + safeName(title) + ' ' + (++suffix) + '.md'
        await invoke('eon2:notes:save', { title, content: await file.text(), path })
        reserved.add(fold(path)); count++
      }
      await refresh()
      setNotice(count + ' Markdown dosyası içe aktarıldı.')
    } catch (error) { setNotice(count + ' not aktarıldı. Hata: ' + describeError(error)); await refresh() }
    finally { setImporting(false); if (importFile.current) importFile.current.value = '' }
  }
  const openWiki = (title: string) => {
    const target = notes.find(note => fold(note.title) === fold(title) || fold(basename(notePath(note))) === fold(title))
    if (target) openNote(target)
    else setNotice('"' + title + '" bağlantısına ait not bulunamadı.')
  }
  const renderFile = (note: WorkspaceNote, depth: number) => <button type="button" key={note.id}
    className={'eon-notes-file ' + (note.id === current?.id ? 'is-active' : '')}
    style={{ paddingLeft: 13 + depth * 16 }} onClick={() => openNote(note)} title={notePath(note)}>
    <FileText size={15}/><span>{note.path ? basename(note.path) : note.title}</span>{note.unresolved && <AlertCircle size={14}/>}
  </button>
  const renderFolder = (node: Tree, depth: number): React.ReactNode => <div key={node.path}>
    <div className="eon-notes-folder" style={{ paddingLeft: 7 + depth * 16 }}>
      <button type="button" title={node.path} aria-expanded={!collapsed.has(node.path)} onClick={() => setCollapsed(before => {
        const next = new Set(before)
        if (next.has(node.path)) next.delete(node.path); else next.add(node.path)
        return next
      })}>
        {collapsed.has(node.path) ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}
        {collapsed.has(node.path) ? <FolderClosed size={15}/> : <FolderOpen size={15}/>}
        <span>{node.name}</span>
      </button>
      <button type="button" className="eon-notes-icon" title={node.name + ' klasörüne not ekle'} onClick={() => newNote(node.path)}><Plus size={13}/></button>
    </div>
    {!collapsed.has(node.path) && <>
      {[...node.folders.values()].sort((a,b) => a.name.localeCompare(b.name,'tr-TR')).map(child => renderFolder(child, depth+1))}
      {[...node.files].sort((a,b) => notePath(a).localeCompare(notePath(b),'tr-TR')).map(file => renderFile(file, depth+1))}
    </>}
  </div>
  const toolbar: Array<{ id: MarkdownFormat; title: string; icon: typeof Bold }> = [
    { id: 'bold', title: 'Kalın', icon: Bold }, { id: 'italic', title: 'İtalik', icon: Italic },
    { id: 'heading', title: 'Başlık', icon: Heading2 }, { id: 'bullet', title: 'Liste', icon: List },
    { id: 'task', title: 'Görev', icon: ListTodo }, { id: 'quote', title: 'Alıntı', icon: Quote },
    { id: 'code', title: 'Kod', icon: Code2 }, { id: 'link', title: 'Bağlantı', icon: Link2 },
  ]
  const words = current?.body.trim() ? current.body.trim().split(/\s+/).length : 0

  return <section className="eon-notes-root" hidden={!active} aria-label="Eon Notes">
    <input ref={importFile} type="file" hidden accept=".md,.markdown,text/markdown" multiple onChange={event => { void importNotes(event.target.files) }}/>
    {notice && <div className="eon-notes-notice" role="status">{notice}<button type="button" title="Bildirimi kapat" onClick={() => setNotice(null)}><X size={14}/></button></div>}
    <div className="eon-notes-workspace">
      {leftOpen && <aside className="eon-notes-sidebar eon-notes-left" aria-label="Not kütüphanesi">
        <div className="eon-notes-panel-heading"><span><Folder size={16}/> Kütüphane <small>{notes.length}</small></span><button type="button" className="eon-notes-icon" title="Sol paneli kapat" onClick={() => setLeftOpen(false)}><PanelLeftClose size={16}/></button></div>
        <div className="eon-notes-panel-switch" role="tablist" aria-label="Not kütüphanesi bölümleri">
          {([{id:'files',title:'Dosyalar',icon:Folder},{id:'search',title:'Ara',icon:Search},{id:'tags',title:'Etiket',icon:Hash}] as const).map(({id,title,icon:Icon}) =>
            <button type="button" key={id} role="tab" aria-selected={panel===id} className={panel===id?'is-active':''} onClick={() => setPanel(id)}><Icon size={15}/>{title}</button>)}
        </div>
        {panel === 'files' && <div className="eon-notes-panel-label"><span>NOT DOSYALARI</span><div>
          <button className="eon-notes-icon" type="button" title="Klasörde yeni not" onClick={() => { const name = window.prompt('Klasör adı', 'Projeler'); if (name) newNote(name) }}><FolderOpen size={16}/></button>
          <button className="eon-notes-icon" type="button" title="Yeni not" onClick={() => newNote()}><FilePlus2 size={16}/></button>
        </div></div>}
        {panel === 'search' && <label className="eon-notes-search"><Search size={15}/><input ref={searchField} aria-label="Notlarda ara" placeholder="Notlarda ara..." value={query} onChange={event => setQuery(event.target.value)}/></label>}
        {panel === 'tags' && <div className="eon-notes-panel-label"><span>ETİKETLER</span><button className="eon-notes-icon" title="Filtreyi temizle" onClick={() => setTagFilter(null)}><X size={15}/></button></div>}
        <div className="eon-notes-tree">
          {panel === 'files' && <>
            {[...tree.folders.values()].sort((a,b) => a.name.localeCompare(b.name,'tr-TR')).map(node => renderFolder(node,0))}
            {tree.files.map(note => renderFile(note,0))}
          </>}
          {panel === 'search' && <>
            {tagFilter && <div className="eon-notes-filter"><Hash size={13}/>{tagFilter}<button type="button" onClick={()=>setTagFilter(null)}><X size={13}/></button></div>}
            {matches.map(note => <button type="button" className="eon-notes-result" key={note.id} onClick={() => openNote(note)}><strong><FileText size={14}/>{note.title}</strong><small>{note.content.replace(/\s+/g, ' ').slice(0,120) || notePath(note)}</small></button>)}
            {!matches.length && <p className="eon-notes-hint">Eşleşen not bulunamadı.</p>}
          </>}
          {panel === 'tags' && <>
            {tagCounts.map(([tag,count]) => <button type="button" className="eon-notes-tag" key={tag} onClick={() => { setTagFilter(tag);setPanel('search') }}><Hash size={14}/>{tag}<small>{count}</small></button>)}
            {!tagCounts.length && <p className="eon-notes-hint">Notlarına #etiket ekleyerek burada grupla.</p>}
          </>}
        </div>
        <footer className="eon-notes-sidebar-footer"><ShieldCheck size={13}/>{notes.length} not · Yerel kasa</footer>
      </aside>}
      <div className="eon-notes-center">
        <div className="eon-notes-tabs">
          {!leftOpen && <button type="button" className="eon-notes-icon" title="Kütüphaneyi aç" onClick={() => setLeftOpen(true)}><PanelLeftOpen size={17}/></button>}
          <div className="eon-notes-tabs-scroll" role="tablist" aria-label="Açık notlar">
            {tabs.map(tab => <div key={tab.key} className={'eon-notes-tab ' + (tab.key===selectedKey ? 'is-active' : '')}>
              <button type="button" role="tab" aria-selected={tab.key===selectedKey} onClick={() => setSelectedKey(tab.key)}><FileText size={14}/><span>{tab.title || 'Başlıksız'}</span>{isDirty(tab) && <i title="Kaydedilmemiş değişiklik"/>}</button>
              <button type="button" title="Sekmeyi kapat" className="eon-notes-close" onClick={() => { void closeTab(tab.key) }}><X size={13}/></button>
            </div>)}
          </div>
          <button type="button" className="eon-notes-icon" title="Markdown içe aktar" aria-label="Markdown içe aktar" disabled={importing} onClick={() => importFile.current?.click()}><Download size={16}/></button>
          <button type="button" className="eon-notes-icon" title="Yeni not" onClick={() => newNote()}><Plus size={17}/></button>
          {!rightOpen && <button type="button" className="eon-notes-icon" title="Bilgi panelini aç" onClick={() => setRightOpen(true)}><PanelRightOpen size={17}/></button>}
        </div>
        {current ? <>
          <div className="eon-notes-crumbbar">
            <button type="button" className="eon-notes-path" title="Notun dosya yolunu değiştir" onClick={changePath}><Folder size={14}/>{current.path}</button>
            <div>
              <button type="button" className="eon-notes-icon" title="Markdown indir" onClick={exportNote}><Download size={16}/></button>
              <button type="button" className="eon-notes-icon danger" title="Notu sil" disabled={!current.id || Boolean(conflict)} onClick={() => {void deleteNote()}}><Trash2 size={16}/></button>
              <button type="button" className="eon-notes-icon" title="Sağ paneli göster veya gizle" onClick={() => setRightOpen(value => !value)}>{rightOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
            </div>
          </div>
          {conflict ? <div className="eon-notes-conflict"><ConflictResolver conflict={conflict} onResolved={async () => {
            setTabs(previous => previous.filter(tab => tab.key !== current.key))
            setSelectedKey(null)
            await refresh()
          }}/></div> : <>
            <div className="eon-notes-document-head">
              <input aria-label="Not başlığı" maxLength={256} placeholder="Başlıksız not" value={current.title} onChange={event => {
                const title = event.target.value
                const autoPath = !current.id && basename(current.path) === safeName(current.title)
                patchTab(current.key, { title, error: null,
                  ...(autoPath ? { path: (dir(current.path) ? dir(current.path) + '/' : '') + safeName(title) + '.md' } : {}) })
              }}/>
              <div className="eon-notes-modes" aria-label="Editör görünümü">
                <button type="button" className={mode==='edit'?'is-active':''} aria-pressed={mode==='edit'} onClick={() => setMode('edit')}><Pencil size={15}/> Düzenle</button>
                <button type="button" className={mode==='split'?'is-active':''} aria-pressed={mode==='split'} onClick={() => setMode('split')}><Columns2 size={15}/> Böl</button>
                <button type="button" className={mode==='read'?'is-active':''} aria-pressed={mode==='read'} onClick={() => setMode('read')}><Eye size={15}/> Oku</button>
              </div>
            </div>
            {mode !== 'read' && <div className="eon-notes-format" aria-label="Markdown biçimlendirme">
              {toolbar.map(({id,title,icon:Icon}) => <button key={id} type="button" title={title} aria-label={title} onClick={() => editor.current?.format(id)}><Icon size={16}/></button>)}
              <span className="eon-notes-format-space"/>
              <button type="button" title="Geri al" aria-label="Geri al" onClick={() => editor.current?.undo()}><Undo2 size={16}/></button>
              <button type="button" title="Yinele" aria-label="Yinele" onClick={() => editor.current?.redo()}><Redo2 size={16}/></button>
            </div>}
            <div className={'eon-notes-document mode-' + mode}>
              {mode !== 'read' && <MarkdownEditor key={current.key + (current.stale ? '-stale' : '')} ref={editor} readOnly={current.stale}
                value={current.body} onChange={body => patchTab(current.key, { body, error: null })}/>}
              {mode !== 'edit' && <div className="eon-notes-preview"><Suspense fallback={<p className="eon-notes-hint">Önizleme hazırlanıyor...</p>}>
                <MarkdownPreview content={current.body} onOpenNote={openWiki}/>
              </Suspense></div>}
            </div>
            {current.error && <div className="eon-notes-error" role="alert"><AlertCircle size={16}/><span>{current.error}</span><button type="button" onClick={() => {void saveCopy()}}>Kopya oluştur</button></div>}
          </>}
        </> : <div className="eon-notes-empty">
          <span className="eon-notes-empty-mark"><BookOpen size={40}/></span>
          <h2>Fikirlerin burada şekillensin.</h2>
          <p>Not oluştur, Markdown ile yaz ve notlarını birbirine bağla. İki cihazda da aynı çalışma alanını kullan.</p>
          <div><button type="button" className="eon-notes-create" onClick={() => newNote()}><Plus size={16}/> Yeni not</button>
            <button type="button" className="eon-notes-secondary" onClick={() => {setPanel('search');setLeftOpen(true);window.requestAnimationFrame(()=>searchField.current?.focus())}}><Search size={16}/> Not ara</button></div>
          <small><kbd>Ctrl N</kbd> Yeni not <kbd>Ctrl O</kbd> Ara <kbd>Ctrl S</kbd> Kaydet</small>
        </div>}
        <footer className="eon-notes-status">
          <span><ShieldCheck size={13}/> SQLite · Revizyon geçmişi</span>
          <span>{current ? <>{savingKey === current.key ? 'Kaydediliyor...' : current.stale ? 'Sürüm değişti' : isDirty(current) ? 'Kaydedilmedi' : 'Kaydedildi'} <i/> {words} kelime <i/> {current.body.length} karakter</> : notes.length + ' not'}</span>
          {current && <button type="button" title="Kaydet" disabled={!isDirty(current) || savingKey===current.key || Boolean(conflict)} onClick={() => {void saveTab(current.key)}}><Save size={13}/> Kaydet</button>}
        </footer>
      </div>
      {rightOpen && <aside className="eon-notes-sidebar eon-notes-right" aria-label="Not ilişkileri">
        <div className="eon-notes-panel-heading"><span><Link2 size={15}/> Not bilgileri</span><button type="button" className="eon-notes-icon" title="Sağ paneli kapat" onClick={() => setRightOpen(false)}><PanelRightClose size={16}/></button></div>
        <div className="eon-notes-panel-switch" role="tablist">
          <button type="button" role="tab" aria-selected={inspector==='outline'} className={inspector==='outline'?'is-active':''} onClick={() => setInspector('outline')}>İçindekiler</button>
          <button type="button" role="tab" aria-selected={inspector==='links'} className={inspector==='links'?'is-active':''} onClick={() => setInspector('links')}>Bağlantılar</button>
        </div>
        <div className="eon-notes-inspector">
          {!current ? <p className="eon-notes-hint">Bir not açtığında içindekiler ve bağlantılar burada görünür.</p> :
            inspector === 'outline' ? <>{outline.map(item => <div className="eon-notes-outline-item" style={{paddingLeft:10+(item.level-1)*12}} key={item.line}><Hash size={12}/>{item.title}</div>)}{outline.length===0 && <p className="eon-notes-hint">Başlık oluşturmak için ## kullan.</p>}</> :
            <>
              <div className="eon-notes-inspector-label">BU NOTUN BAĞLANTILARI</div>
              {outgoing.map((target,index) => <button type="button" className="eon-notes-link" onClick={() => openWiki(target)} key={target+index}><Link2 size={13}/>{target}</button>)}
              {!outgoing.length && <p className="eon-notes-hint">[[Not adı]] ile bağlantı ekle.</p>}
              <div className="eon-notes-inspector-label">GERİ BAĞLANTILAR</div>
              {backlinks.map(note => <button type="button" className="eon-notes-link" onClick={() => openNote(note)} key={note.id}><FileText size={13}/>{note.title}</button>)}
              {!backlinks.length && <p className="eon-notes-hint">Henüz geri bağlantı yok.</p>}
            </>
          }
        </div>
        <footer className="eon-notes-sidebar-footer"><Check size={13}/> Cihazda güvenle saklanır</footer>
      </aside>}
    </div>
  </section>
}
