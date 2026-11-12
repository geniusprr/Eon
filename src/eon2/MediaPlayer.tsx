import { useState, type ReactNode } from 'react'
import { Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { DeckMediaSample } from '../../shared/eon-deck-telemetry'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import './media-player.css'

type Props = {
  media: DeckMediaSample | null | undefined
  available: boolean
  busy: boolean
  onCommand: (id: string) => void
}

export function MediaPlayer({ media, available, busy, onCommand }: Props) {
  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null)
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null)
  const artwork = media?.artwork && media.artwork !== failedArtwork ? media.artwork : null
  const playing = media?.playing === true
  const enabled = available && !busy
  const title = media?.title || 'Müziğine yer aç'
  const detail = media?.artist || (!available ? 'Medya kontrolü kullanılamıyor' : media === undefined
    ? 'Medya bilgisi bekleniyor' : media ? 'Windows medyası' : 'Bir müzik uygulamasında parça aç')
  const control = (id: string, label: string, icon: ReactNode, primary = false) =>
    <button type="button" className={primary ? 'eon-player-button is-primary' : 'eon-player-button'}
      aria-label={label} title={label} disabled={!enabled} onClick={() => onCommand(id)}>{icon}</button>

  return <section ref={setPlayerElement} className="eon-player" aria-label="Medya oynatıcı" aria-busy={busy}>
    <div className={`eon-player-surface${artwork ? ' has-artwork' : ''}`}>
      {artwork && <div className="eon-player-ambience" aria-hidden="true"><img className="eon-player-ambilight" src={artwork} alt=""/></div>}
      <div className="eon-player-content">
        <div className="eon-player-track">
          <div className="eon-player-cover">
            {artwork ? <img src={artwork} alt={`${media?.title || 'Parça'} kapağı`} onError={() => setFailedArtwork(artwork)}/>
              : <Music2 aria-hidden="true"/>}
          </div>
          <div className="eon-player-metadata">
            <span className="eon-player-status"><i className={playing ? 'is-playing' : ''}/>{media ? playing ? 'Şimdi çalıyor' : 'Duraklatıldı' : 'Müzik'}</span>
            <strong title={title}>{title}</strong>
            <div className="eon-player-detail">
              <span className="eon-player-artist" title={detail}>{detail}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="eon-player-button eon-player-volume-trigger" disabled={!enabled}
                    aria-label="Ses kontrolleri" title="Ses kontrolleri"><Volume2/></button>
                </PopoverTrigger>
                <PopoverContent className="eon-player-volume-panel" aria-label="Bilgisayar sesi"
                  portalContainer={playerElement?.closest<HTMLElement>('.eon2-app')}>
                  <strong>Bilgisayar sesi</strong>
                  <p>Windows’un genel sesini kontrol eder.</p>
                  <div className="eon-player-volume" role="group" aria-label="Bilgisayar sesi">
                    {control('volumeDown', 'Sesi azalt', <Volume1/>)}
                    {control('mute', 'Sesi kapat veya aç', <VolumeX/>)}
                    {control('volumeUp', 'Sesi artır', <Volume2/>)}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        <div className="eon-player-transport" role="group" aria-label="Oynatma kontrolleri">
          {control('previous', 'Önceki parça', <SkipBack/>)}
          {control('playPause', playing ? 'Duraklat' : 'Oynat', playing ? <Pause/> : <Play/>, true)}
          {control('next', 'Sonraki parça', <SkipForward/>)}
        </div>
      </div>
    </div>
  </section>
}
