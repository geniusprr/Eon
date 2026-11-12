import { BrowserWindow, desktopCapturer, ipcMain, session, type Display, type IpcMainEvent } from 'electron'

export interface CaptureProfile { size: number; fps: number; bitrate: number }
export interface VideoPacket { bytes: Uint8Array; key: boolean; width: number; height: number; codec: 'avc' | 'vp8' }
const FRAME_CHANNEL = 'eon2:pc-capture:frame'
const ERROR_CHANNEL = 'eon2:pc-capture:error'
const CAPTURE_URL = 'https://eon-pc-capture.invalid/'
const capturePermission = (permission: string) => permission === 'display-capture' || permission === 'media'

export class PcScreenCapture {
  private window: BrowserWindow | null = null
  private closed = false
  private captureSession: Electron.Session | null = null

  constructor(private readonly preload: string, private readonly frame: (packet: VideoPacket) => void,
    private readonly failed: (message: string) => void) {}

  async start(display: Display, profile: CaptureProfile, preferAvc: boolean) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    if (this.closed) return
    const source = sources.find(item => item.display_id === String(display.id))
    if (!source) throw new Error('Seçilen ekranın görüntüsü alınamıyor.')
    const captureSession = session.fromPartition('eon2-pc-capture')
    this.captureSession = captureSession
    captureSession.protocol.handle('https', request => request.url === CAPTURE_URL
      ? new Response(CAPTURE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : new Response(null, { status: 404 }))
    const window = new BrowserWindow({
      show: false, skipTaskbar: true, width: 32, height: 32,
      webPreferences: { session: captureSession, preload: this.preload, sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    })
    this.window = window
    const contents = window.webContents
    captureSession.setPermissionRequestHandler((sender, permission, callback) =>
      callback(!this.closed && sender === contents && capturePermission(permission)))
    captureSession.setPermissionCheckHandler((sender, permission) =>
      !this.closed && sender === contents && capturePermission(permission))
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    contents.once('render-process-gone', () => this.failed('Ekran yakalama işlemi kapandı.'))
    window.once('closed', () => { if (!this.closed) this.failed('Ekran yakalama penceresi kapandı.') })
    ipcMain.on(FRAME_CHANNEL, this.onFrame)
    ipcMain.on(ERROR_CHANNEL, this.onError)
    await window.loadURL(CAPTURE_URL)
    if (!this.closed) contents.send('eon2:pc-capture:start', { sourceId: source.id, ...profile, preferAvc })
  }

  close() {
    this.closed = true
    ipcMain.off(FRAME_CHANNEL, this.onFrame)
    ipcMain.off(ERROR_CHANNEL, this.onError)
    if (this.captureSession) {
      this.captureSession.setPermissionRequestHandler(null)
      this.captureSession.setPermissionCheckHandler(null)
      this.captureSession.protocol.unhandle('https')
      this.captureSession = null
    }
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private trusted(event: IpcMainEvent) {
    const contents = this.window?.webContents
    return !this.closed && contents && event.sender === contents && event.senderFrame === contents.mainFrame
  }

  private onFrame = (event: IpcMainEvent, packet: VideoPacket) => {
    if (!this.trusted(event) || !packet || !(packet.bytes instanceof Uint8Array) ||
      (packet.codec !== 'avc' && packet.codec !== 'vp8') || typeof packet.key !== 'boolean' ||
      packet.bytes.byteLength === 0 || packet.bytes.byteLength > 1024 * 1024 ||
      !Number.isInteger(packet.width) || !Number.isInteger(packet.height) ||
      packet.width < 16 || packet.height < 16 || packet.width > 1920 || packet.height > 1920) return
    this.frame(packet)
  }

  private onError = (event: IpcMainEvent, message: unknown) => {
    if (this.trusted(event)) this.failed(typeof message === 'string' ? message.slice(0, 220) : 'Ekran yakalama durdu.')
  }
}

const CAPTURE_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; media-src blob:">
</head><body><script>
window.eonPcCapture.start(async config => {
  const bridge = window.eonPcCapture;
  const fail = error => bridge.error(error?.message || String(error));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: config.sourceId,
        maxWidth: config.size, maxHeight: config.size, maxFrameRate: config.fps } }
    });
    const track = stream.getVideoTracks()[0];
    track.onended = () => fail('Windows ekran yakalamayı durdurdu.');
    track.contentHint = 'detail';
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
    const reader = processor.readable.getReader();
    const first = await reader.read();
    if (first.done) throw new Error('Ekrandan görüntü alınamadı.');
    const width = first.value.displayWidth;
    const height = first.value.displayHeight;
    const base = { width, height, bitrate: config.bitrate, framerate: config.fps,
      latencyMode: 'realtime', bitrateMode: 'variable', hardwareAcceleration: 'no-preference' };
    const profiles = [];
    if (config.preferAvc && Math.ceil(width / 16) * Math.ceil(height / 16) <= 8192) {
      profiles.push({ name: 'avc', settings: { ...base, codec: 'avc1.42E028', avc: { format: 'annexb' },
        width: width & ~1, height: height & ~1, hardwareAcceleration: 'prefer-hardware' } });
    }
    profiles.push({ name: 'vp8', settings: { ...base, codec: 'vp8' } });
    let encoder;
    const send = (chunk, profile) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      bridge.frame({ bytes, key: chunk.type === 'key', width: profile.settings.width,
        height: profile.settings.height, codec: profile.name });
    };
    let keyTime = first.value.timestamp;
    try {
      for (const profile of profiles) {
        let opening = true;
        let keyChunk;
        try {
          if (!(await VideoEncoder.isConfigSupported(profile.settings)).supported) continue;
          const candidate = new VideoEncoder({
            output(chunk) {
              if (opening) keyChunk = chunk;
              else send(chunk, profile);
            },
            error(error) { if (!opening) fail(error); },
          });
          try {
            candidate.configure(profile.settings);
            candidate.encode(first.value, { keyFrame: true });
            await candidate.flush();
            if (!keyChunk || keyChunk.type !== 'key') throw new Error('İlk video karesi kodlanamadı.');
          } catch (error) {
            if (candidate.state !== 'closed') candidate.close();
            throw error;
          }
          encoder = candidate;
          opening = false;
          send(keyChunk, profile);
          break;
        } catch (error) {
          if (profile.name === 'vp8') throw error;
        }
      }
    } finally { first.value.close(); }
    if (!encoder) throw new Error('Windows uyumlu bir ekran kodlayıcısı başlatamadı.');
    for (let item = await reader.read(); !item.done; item = await reader.read()) {
      const frame = item.value;
      try {
        if (frame.displayWidth !== width || frame.displayHeight !== height) throw new Error('Ekran çözünürlüğü değişti.');
        if (encoder.encodeQueueSize > 1) continue;
        const keyFrame = frame.timestamp - keyTime >= 1000000;
        if (keyFrame) keyTime = frame.timestamp;
        encoder.encode(frame, { keyFrame });
      } finally { frame.close(); }
    }
    fail('Ekran görüntüsü kesildi.');
  } catch (error) { fail(error); }
});
</script></body></html>`
