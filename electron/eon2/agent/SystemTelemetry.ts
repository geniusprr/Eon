import os from 'node:os'
import { statfsSync } from 'node:fs'

export interface CpuTick {
  idle: number
  total: number
}

export interface SystemSnapshot {
  sampledAt: number
  hostname: string
  platform: string
  cpu: { usagePercent: number | null; logicalCores: number; model: string }
  memory: { totalBytes: number; usedBytes: number; usagePercent: number }
  disk?: { totalBytes: number; usedBytes: number; usagePercent: number }
  uptimeSeconds: number
}

export function cpuTicks(cpus: readonly os.CpuInfo[]): CpuTick {
  return cpus.reduce((acc, cpu) => {
    acc.idle += cpu.times.idle
    acc.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
    return acc
  }, { idle: 0, total: 0 })
}

export function cpuUsagePercent(previous: CpuTick, current: CpuTick): number | null {
  const total = current.total - previous.total
  if (!Number.isFinite(total) || total <= 0) return null
  const idle = current.idle - previous.idle
  if (!Number.isFinite(idle) || idle < 0 || idle > total) return null
  return Math.round(Math.min(100, Math.max(0, (1 - idle / total) * 100)) * 10) / 10
}

/** Samples are shared across all desktop views; no background polling process. */
export class SystemTelemetry {
  private previous: CpuTick | null = null
  private previousTime = 0
  private cached: SystemSnapshot | null = null
  private diskSample: { at: number; value: SystemSnapshot['disk'] } | null = null

  private disk(now: number): SystemSnapshot['disk'] {
    if (this.diskSample && now - this.diskSample.at < 30_000 && now >= this.diskSample.at) return this.diskSample.value
    let value: SystemSnapshot['disk']
    try {
      const { blocks, bsize, bfree } = statfsSync(os.homedir())
      const totalBytes = blocks * bsize
      const usedBytes = Math.max(0, blocks - bfree) * bsize
      if (totalBytes > 0) value = { totalBytes, usedBytes, usagePercent: Math.min(100, usedBytes / totalBytes * 100) }
    } catch { /* Disk usage is optional on systems without statfs support. */ }
    this.diskSample = { at: now, value }
    return value
  }

  snapshot(now = Date.now()): SystemSnapshot {
    // Avoid unnecessary native calls when multiple widgets request the same frame.
    if (this.cached && now - this.previousTime < 800 && now >= this.previousTime) return this.cached
    const cpus = os.cpus()
    const current = cpuTicks(cpus)
    const totalBytes = os.totalmem()
    const usedBytes = Math.min(totalBytes, Math.max(0, totalBytes - os.freemem()))
    const usagePercent = totalBytes ? Math.round(usedBytes / totalBytes * 1000) / 10 : 0
    const snapshot: SystemSnapshot = {
      sampledAt: now,
      hostname: os.hostname(),
      platform: process.platform,
      cpu: {
        usagePercent: this.previous ? cpuUsagePercent(this.previous, current) : null,
        logicalCores: cpus.length,
        model: cpus[0]?.model ?? 'Unknown processor',
      },
      memory: { totalBytes, usedBytes, usagePercent },
      disk: this.disk(now),
      uptimeSeconds: os.uptime(),
    }
    this.previous = current
    this.previousTime = now
    this.cached = snapshot
    return snapshot
  }
}
