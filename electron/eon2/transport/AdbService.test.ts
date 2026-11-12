import assert from 'node:assert/strict'
import { AuthorizedUsbSessionTracker, parseAdbDevices, resolveAdbBinary } from './AdbService.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), [])
const found = parseAdbDevices(`List of devices attached
ABC123 device product:foo model:Pixel_9 device:pixel transport_id:8
R8XX unauthorized usb:2-1 transport_id:5
192.168.2.1:5555 device model:Remote
ZZZZ offline
`)
assert.equal(found.length, 4)
assert.deepEqual(found.map(({ state }) => state), ['device', 'unauthorized', 'device', 'offline'])
assert.equal(found[0].model, 'Pixel_9')
assert.equal(found[1].usb, true)
assert.equal(found[2].usb, false)
assert.equal(found[0].transportId, '8')
assert.equal(found[1].transportId, '5')
assert.equal(found[2].transportId, null)

const sessions = new AuthorizedUsbSessionTracker()
const firstUsb = found[0]
const nextUsb = { ...firstUsb, transportId: '9' }
assert.deepEqual(sessions.observe(found), [firstUsb.serial])
assert.deepEqual(sessions.observe(found), [], 'polling must not relaunch the same USB session')
assert.deepEqual(sessions.observe([{ ...firstUsb, state: 'unauthorized' }]), [], 'USB authorization is required')
assert.deepEqual(sessions.observe([firstUsb]), [firstUsb.serial], 'authorization after reconnect permits launch')
assert.deepEqual(sessions.observe([nextUsb]), [firstUsb.serial], 'new transport identity indicates a physical reconnect')
assert.deepEqual(sessions.observe([nextUsb]), [], 'reconnected session launches once')
assert.deepEqual(sessions.observe([]), [], 'disconnection clears session state')
assert.deepEqual(sessions.observe([firstUsb]), [firstUsb.serial], 'reconnection with same serial may launch')
const previous = process.env.EON_ADB_PATH
delete process.env.EON_ADB_PATH
const root = mkdtempSync(path.join(os.tmpdir(), 'eon-adb-test-'))
try {
  assert.equal(resolveAdbBinary(root), 'adb')
  mkdirSync(path.join(root, 'mobile'))
  const bundled = path.join(root, 'mobile', 'adb.exe')
  writeFileSync(bundled, 'fixture')
  assert.equal(resolveAdbBinary(root), bundled)
} finally {
  if (previous === undefined) delete process.env.EON_ADB_PATH
  else process.env.EON_ADB_PATH = previous
  rmSync(root, { recursive: true, force: true })
}
console.log('Eon 2.0 ADB parsing tests passed')
