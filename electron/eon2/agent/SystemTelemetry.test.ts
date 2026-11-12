import assert from 'node:assert/strict'
import { cpuTicks, cpuUsagePercent, SystemTelemetry } from './SystemTelemetry.js'

assert.deepEqual(cpuTicks([
  { model: 'a', speed: 10, times: { idle: 60, user: 20, nice: 0, sys: 20, irq: 0 } },
  { model: 'b', speed: 10, times: { idle: 50, user: 30, nice: 0, sys: 20, irq: 0 } },
]), { idle: 110, total: 200 })
assert.equal(cpuUsagePercent({ idle: 20, total: 100 }, { idle: 40, total: 200 }), 80)
assert.equal(cpuUsagePercent({ idle: 20, total: 100 }, { idle: 20, total: 100 }), null)
assert.equal(cpuUsagePercent({ idle: 20, total: 100 }, { idle: 19, total: 200 }), null)
const telemetry = new SystemTelemetry()
const first = telemetry.snapshot(1000)
const cached = telemetry.snapshot(1500)
assert.equal(first, cached)
assert.equal(first.cpu.usagePercent, null)
assert.equal(first.memory.totalBytes >= first.memory.usedBytes, true)
assert.equal(first.cpu.logicalCores > 0, true)
console.log('Eon 2.0 system telemetry tests passed')
