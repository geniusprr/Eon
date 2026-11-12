import { useEffect, useState } from 'react'
import { ArrowUpFromLine, Link2 } from 'lucide-react'

export type DropDestination = 'transfers' | 'automations'

export function FileDropTargets({ onDrop, onError }: {
  onDrop: (destination: DropDestination, paths: string[]) => void
  onError: (message: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState<DropDestination | null>(null)
  useEffect(() => {
    let timeout: number | undefined
    const hide = () => { window.clearTimeout(timeout); setVisible(false); setHovered(null) }
    const fileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files')
    const target = (event: DragEvent) => (event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-file-destination]')?.dataset.fileDestination : null) as DropDestination | null
    const drag = (event: DragEvent) => {
      if (!fileDrag(event)) return
      event.preventDefault()
      if (document.querySelector('dialog[open]')) return
      const destination = target(event)
      if (event.dataTransfer) event.dataTransfer.dropEffect = destination ? 'copy' : 'none'
      setVisible(true)
      setHovered(destination)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(hide, 500)
    }
    const drop = (event: DragEvent) => {
      if (!fileDrag(event)) return
      event.preventDefault()
      hide()
      const destination = target(event)
      if (!destination || !event.dataTransfer) return
      try {
        const bridge = window.kapanisDesktop
        const paths = bridge?.pathsForDroppedFiles?.(Array.from(event.dataTransfer.files))
        if (!paths?.length) throw new Error('Windows Gezgini’nden yerel bir dosya bırak.')
        if (destination === 'automations' && paths.length !== 1) throw new Error('Kısayol oluşturmak için tek dosya bırak.')
        onDrop(destination, paths)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Dosya bırakılamadı.')
      }
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null && (event.clientX <= 0 || event.clientY <= 0 ||
          event.clientX >= innerWidth || event.clientY >= innerHeight)) hide()
    }
    window.addEventListener('dragenter', drag)
    window.addEventListener('dragover', drag)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', hide)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('dragenter', drag)
      window.removeEventListener('dragover', drag)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', hide)
    }
  }, [onDrop, onError])
  if (!visible) return null
  return <div className="eon2-file-drop-targets" aria-hidden="true">
    <div data-file-destination="transfers" className={hovered === 'transfers' ? 'is-targeted' : ''}>
      <ArrowUpFromLine size={30}/><strong>LocalSend</strong><span>Telefona gönder</span>
    </div>
    <div data-file-destination="automations" className={hovered === 'automations' ? 'is-targeted' : ''}>
      <Link2 size={30}/><strong>Kısayol</strong><span>Bu dosyayı açan kısayol oluştur</span>
    </div>
  </div>
}
