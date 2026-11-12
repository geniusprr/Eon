import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  DeckDiskSample, DeckGpuSample, DeckMediaSample, DeckNetworkInterface,
  DeckNetworkSample, DeckTelemetrySnapshot,
} from '../../../shared/eon-deck-telemetry.js'

const run = promisify(execFile)

// These scripts contain fixed commands and never interpolate renderer or phone input.
// The executable is the Windows System32 PowerShell binary, with shell execution disabled.
const mediaScript = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
  '$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]',
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') } | Select-Object -First 1",
  'function Resolve-Operation($op, $type) {',
  '  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))',
  "  if (-not $task.Wait(1200)) { throw 'WinRT timed out' }",
  '  $task.Result',
  '}',
  '$manager = Resolve-Operation ($managerType::RequestAsync()) $managerType',
  '$session = $manager.GetCurrentSession()',
  "if ($null -eq $session) { Write-Output 'null'; exit 0 }",
  '$media = Resolve-Operation ($session.TryGetMediaPropertiesAsync()) $propertiesType',
  '$artwork = $null',
  '$stream = $null; $reader = $null; $image = $null; $bitmap = $null; $graphics = $null; $output = $null; $imageStream = $null',
  'try {',
  '  if ($null -ne $media.Thumbnail) {',
  '    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]',
  '    $stream = Resolve-Operation ($media.Thumbnail.OpenReadAsync()) $streamType',
  // WinRT returns a COM interface: inherited stream members need explicit interface reflection.
  '    $randomType = [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]',
  "    $size = $randomType.GetProperty('Size').GetValue($stream)",
  '    if ($size -gt 0 -and $size -le 2097152) {',
  "      $readStream = $randomType.GetMethod('GetInputStreamAt').Invoke($stream, @([uint64]0))",
  '      $reader = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]::new($readStream)',
  '      $loaded = Resolve-Operation ($reader.LoadAsync([uint32]$size)) ([uint32])',
  '      $bytes = New-Object byte[] $loaded; $reader.ReadBytes($bytes)',
  '      Add-Type -AssemblyName System.Drawing',
  '      $imageStream = [System.IO.MemoryStream]::new($bytes, $false)',
  '      $image = [System.Drawing.Image]::FromStream($imageStream)',
  '      $scale = [Math]::Min(1, 320 / [Math]::Max($image.Width, $image.Height))',
  '      $bitmap = [System.Drawing.Bitmap]::new([Math]::Max(1, [int]($image.Width * $scale)), [Math]::Max(1, [int]($image.Height * $scale)))',
  '      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
  '      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '      $graphics.DrawImage($image, 0, 0, $bitmap.Width, $bitmap.Height)',
  '      $output = [System.IO.MemoryStream]::new(); $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Jpeg)',
  '      if ($output.Length -le 131072) { $artwork = "data:image/jpeg;base64," + [Convert]::ToBase64String($output.ToArray()) }',
  '    }',
  '  }',
  // Artwork is optional: a provider with no readable thumbnail still supplies metadata.
  '} catch { $artwork = $null } finally {',
  '  foreach ($resource in @($graphics, $bitmap, $image, $output, $imageStream, $reader, $stream)) {',
  '    if ($null -ne $resource -and [System.Runtime.InteropServices.Marshal]::IsComObject($resource)) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($resource) }',
  '    elseif ($resource -is [System.IDisposable]) { $resource.Dispose() }',
  '  }',
  '}',
  "@{ artwork = $artwork; title = $media.Title; artist = $media.Artist; playing = ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') } | ConvertTo-Json -Compress",
].join('\n')

const disksScript = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, Size, FreeSpace)",
  'ConvertTo-Json -InputObject $drives -Compress -Depth 3',
].join('\n')

const networkScript = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$counters = @(Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes)',
  'ConvertTo-Json -InputObject $counters -Compress -Depth 3',
].join('\n')

// Used only when NVIDIA's fixed-path executable is unavailable. No temperature is
// promised by Windows GPU engine counters and unsupported hosts return null.
const windowsGpuScript = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$items = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)',
  "$usage = @($items | Where-Object { $_.Name -match 'engtype_3D|engtype_Compute' } | ForEach-Object { [double]$_.UtilizationPercentage } | Measure-Object -Maximum)",
  "if ($items.Count -eq 0 -or $usage.Count -eq 0 -or $null -eq $usage[0].Maximum) { Write-Output 'null'; exit 0 }",
  '@{ usagePercent = [Math]::Round([Math]::Min(100, [Math]::Max(0, $usage[0].Maximum)), 1); temperatureC = $null } | ConvertTo-Json -Compress',
].join('\n')

function rows(value: unknown): unknown[] {
  return value === null || value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function finiteCounter(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,18}$/.test(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** Strictly validates untrusted native subprocess JSON before exposing it over IPC/USB. */
export function parseDiskSamples(raw: unknown): DeckDiskSample[] {
  const disks: DeckDiskSample[] = []
  const seen = new Set<string>()
  for (const item of rows(raw).slice(0, 32)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const name = row.DeviceID
    const totalBytes = finiteCounter(row.Size)
    const freeBytes = finiteCounter(row.FreeSpace)
    if (typeof name !== 'string' || !/^[A-Za-z]:$/.test(name) ||
        totalBytes === null || totalBytes <= 0 || freeBytes === null || freeBytes > totalBytes ||
        seen.has(name.toUpperCase())) continue
    seen.add(name.toUpperCase())
    const usedBytes = totalBytes - freeBytes
    disks.push({ name: name.toUpperCase(), totalBytes, usedBytes,
      usagePercent: Math.round((usedBytes / totalBytes) * 1000) / 10 })
  }
  return disks
}

/** Rates come from successive OS byte counters; first sample and resets are unknown. */
export function parseNetworkSample(raw: unknown, previous: DeckNetworkSample | null, sampledAt: number): DeckNetworkSample {
  const elapsed = previous ? (sampledAt - previous.sampledAt) / 1000 : 0
  const previousByName = new Map<string, DeckNetworkInterface>(
    previous?.interfaces.map(item => [item.name, item] as const) ?? [],
  )
  const interfaces: DeckNetworkInterface[] = []
  const seen = new Set<string>()
  for (const item of rows(raw).slice(0, 64)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const name = row.Name
    const receivedBytes = finiteCounter(row.ReceivedBytes)
    const sentBytes = finiteCounter(row.SentBytes)
    if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
        name.includes('\0') || seen.has(name) || receivedBytes === null || sentBytes === null) continue
    seen.add(name)
    const old = previousByName.get(name)
    const validElapsed = elapsed >= 0.5 && elapsed <= 120
    const receiveBytesPerSecond = validElapsed && old && receivedBytes >= old.receivedBytes
      ? Math.round((receivedBytes - old.receivedBytes) / elapsed) : null
    const sendBytesPerSecond = validElapsed && old && sentBytes >= old.sentBytes
      ? Math.round((sentBytes - old.sentBytes) / elapsed) : null
    interfaces.push({ name, receivedBytes, sentBytes, receiveBytesPerSecond, sendBytesPerSecond })
  }
  const rx = interfaces.map(item => item.receiveBytesPerSecond).filter((value): value is number => value !== null)
  const tx = interfaces.map(item => item.sendBytesPerSecond).filter((value): value is number => value !== null)
  return {
    sampledAt,
    interfaces,
    receiveBytesPerSecond: rx.length ? rx.reduce((sum, value) => sum + value, 0) : null,
    sendBytesPerSecond: tx.length ? tx.reduce((sum, value) => sum + value, 0) : null,
  }
}

/** One in-flight command per source; repeat requests share its last validated data. */
class PollSample<T> {
  private value: T | undefined
  private pending = false
  private next = 0

  read(load: () => Promise<T>, interval: number, fallback: T): T {
    if (!this.pending && Date.now() >= this.next) {
      this.pending = true
      this.next = Date.now() + interval
      void load().then(value => {
        this.value = value
        this.next = Date.now() + interval
      }, () => {
        this.value = undefined
        this.next = Date.now() + 30_000
      }).finally(() => { this.pending = false })
    }
    return this.value === undefined ? fallback : this.value
  }
}

export class WindowsDeckTelemetry {
  private readonly gpu = new PollSample<DeckGpuSample | null>()
  private readonly media = new PollSample<DeckMediaSample | null>()
  private readonly disks = new PollSample<DeckDiskSample[]>()
  private readonly network = new PollSample<DeckNetworkSample | null>()
  private previousNetwork: DeckNetworkSample | null = null
  private powerShellTail: Promise<void> = Promise.resolve()

  constructor(private readonly systemDirectory: string) {}

  snapshot(mediaAllowed: boolean): DeckTelemetrySnapshot {
    const sampledAt = Date.now()
    if (process.platform !== 'win32') return { sampledAt, gpu: null, disks: [], network: null }
    return {
      sampledAt,
      gpu: this.gpu.read(() => this.readGpu(), 5000, null),
      disks: this.disks.read(() => this.readDisks(), 30_000, []),
      network: this.network.read(() => this.readNetwork(), 5000, null),
      ...(mediaAllowed ? { media: this.media.read(() => this.readMedia(), 4500, null) } : {}),
    }
  }

  private powerShell(script: string, timeout = 5000): Promise<unknown> {
    // Concurrent snapshots can arrive from several paired phones. Bound OS probe
    // processes to one PowerShell instance to avoid a memory/CPU spike.
    const task = this.powerShellTail.then(async () => {
      const { stdout } = await run(path.join(this.systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
      ], { shell: false, timeout, maxBuffer: 256 * 1024, windowsHide: true })
      return JSON.parse(stdout.trim()) as unknown
    })
    this.powerShellTail = task.then(() => undefined, () => undefined)
    return task
  }

  private async readGpu(): Promise<DeckGpuSample | null> {
    const systemRoot = path.parse(this.systemDirectory).root
    const candidates = [
      path.join(this.systemDirectory, 'nvidia-smi.exe'),
      path.join(systemRoot, 'Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    ]
    for (const executable of candidates) {
      if (!existsSync(executable)) continue
      try {
        const { stdout } = await run(executable, [
          '--query-gpu=utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits',
        ], { shell: false, timeout: 2500, maxBuffer: 4096, windowsHide: true })
        const [usage, temperature] = (stdout.trim().split(/\r?\n/)[0] || '').split(',').map(value => value.trim())
        const usagePercent = Number(usage)
        const temperatureC = Number(temperature)
        if (usage && Number.isFinite(usagePercent) && usagePercent >= 0 && usagePercent <= 100) {
          return { usagePercent, temperatureC: temperature && Number.isFinite(temperatureC) && temperatureC >= -40 && temperatureC <= 150 ? temperatureC : null }
        }
      } catch { /* Fall back to Windows' GPU engine counters. */ }
    }
    const result = await this.powerShell(windowsGpuScript)
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null
    const sample = result as Record<string, unknown>
    return typeof sample.usagePercent === 'number' && Number.isFinite(sample.usagePercent) &&
      sample.usagePercent >= 0 && sample.usagePercent <= 100
      ? { usagePercent: sample.usagePercent, temperatureC: null } : null
  }

  private async readDisks(): Promise<DeckDiskSample[]> {
    return parseDiskSamples(await this.powerShell(disksScript))
  }

  private async readNetwork(): Promise<DeckNetworkSample> {
    const value = await this.powerShell(networkScript)
    const next = parseNetworkSample(value, this.previousNetwork, Date.now())
    this.previousNetwork = next
    return next
  }

  private async readMedia(): Promise<DeckMediaSample | null> {
    const value = await this.powerShell(mediaScript, 10000)
    return parseMediaSample(value)
  }
}

/** Reject URLs, active image formats and oversized data before IPC/USB transport. */
export function parseMediaSample(value: unknown): DeckMediaSample | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Media session unavailable')
  const media = value as Partial<DeckMediaSample>
  if (typeof media.playing !== 'boolean') throw new Error('Invalid media playback status')
  const artwork = typeof media.artwork === 'string' && media.artwork.length <= 174790 &&
    /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(media.artwork) ? media.artwork : null
  return {
    title: typeof media.title === 'string' ? media.title.slice(0, 150) : '',
    artist: typeof media.artist === 'string' ? media.artist.slice(0, 150) : '',
    playing: media.playing,
    artwork,
  }
}
