import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiskSamples, parseNetworkSample, parseMediaSample } from './WindowsDeckTelemetry.js'
import { describeDeck, parseDeckCommand } from './PcDeck.js'

test('Windows disk samples bound sizes, reject invalid volumes and avoid overflow', () => {
  assert.deepEqual(parseDiskSamples([
    { DeviceID: 'C:', Size: 1000, FreeSpace: 400 },
    { DeviceID: 'D:', Size: '5000', FreeSpace: '1250' },
    { DeviceID: 'C:', Size: 100, FreeSpace: 10 },
    { DeviceID: '../../unsafe', Size: 100, FreeSpace: 10 },
    { DeviceID: 'E:', Size: 100, FreeSpace: 101 },
    { DeviceID: 'F:', Size: '999999999999999999', FreeSpace: 0 },
    { DeviceID: 'G:', Size: -100, FreeSpace: 0 },
  ]), [
    { name: 'C:', totalBytes: 1000, usedBytes: 600, usagePercent: 60 },
    { name: 'D:', totalBytes: 5000, usedBytes: 3750, usagePercent: 75 },
  ])
  assert.deepEqual(parseDiskSamples(null), [])
})

test('network rates use monotonic counters and elapsed time; resets are unknown', () => {
  const first = parseNetworkSample([
    { Name: 'Wi-Fi', ReceivedBytes: 1000, SentBytes: 600 },
    { Name: 'Ethernet', ReceivedBytes: '100', SentBytes: '200' },
  ], null, 1000)
  assert.equal(first.receiveBytesPerSecond, null)
  const second = parseNetworkSample([
    { Name: 'Wi-Fi', ReceivedBytes: 5000, SentBytes: 2600 },
    { Name: 'Ethernet', ReceivedBytes: 300, SentBytes: 2200 },
  ], first, 3000)
  assert.equal(second.receiveBytesPerSecond, 2100)
  assert.equal(second.sendBytesPerSecond, 2000)
  assert.equal(second.interfaces[0].receiveBytesPerSecond, 2000)
  const reset = parseNetworkSample([
    { Name: 'Wi-Fi', ReceivedBytes: 1, SentBytes: 2 },
    { Name: 'Ethernet', ReceivedBytes: 400, SentBytes: 2400 },
  ], second, 5000)
  assert.equal(reset.interfaces[0].receiveBytesPerSecond, null)
  assert.equal(reset.interfaces[1].receiveBytesPerSecond, 50)
  assert.equal(reset.receiveBytesPerSecond, 50)
  assert.equal(parseNetworkSample([{ Name: 'Wi-Fi', ReceivedBytes: 10, SentBytes: 10 }], first, 1200).receiveBytesPerSecond, null)
})

test('network sample refuses malformed names, duplicates and unsafe counters', () => {
  const result = parseNetworkSample([
    { Name: 'Wi-Fi', ReceivedBytes: 100, SentBytes: 100 },
    { Name: 'Wi-Fi', ReceivedBytes: 200, SentBytes: 200 },
    { Name: 'bad\0name', ReceivedBytes: 100, SentBytes: 100 },
    { Name: '', ReceivedBytes: 100, SentBytes: 100 },
    { Name: 'overflow', ReceivedBytes: Number.MAX_SAFE_INTEGER + 1, SentBytes: 100 },
    { Name: 'negative', ReceivedBytes: -1, SentBytes: 100 },
  ], null, 1000)
  assert.deepEqual(result.interfaces.map(item => item.name), ['Wi-Fi'])
  assert.equal(result.sendBytesPerSecond, null)
})

test('Android deck hides media controls without scoped execute grant and rejects other commands', () => {
  const denied = describeDeck([], ['system.read'], true)
  assert.equal(denied.shortcutsAllowed, false)
  assert.equal(denied.mediaAvailable, false)
  assert.equal(describeDeck([], ['actions.execute'], true).mediaAvailable, true)
  assert.equal(describeDeck([], ['actions.execute'], false).mediaAvailable, false)
  assert.deepEqual(parseDeckCommand({ id: 'playPause' }), { type: 'media', id: 'playPause' })
  for (const input of [{ id: 'cmd.exe' }, { id: '..' }, { id: '__proto__' }, { id: 3 }, { type: 'media' }]) {
    assert.throws(() => parseDeckCommand(input), /Geçersiz panel komutu/)
  }
})


test('Media artwork only accepts bounded local raster data and preserves metadata without a cover', () => {
  const media = { title: 'Parça', artist: 'Sanatçı', playing: true }
  assert.equal(parseMediaSample(null), null)
  assert.throws(() => parseMediaSample({ playing: 'yes' }))
  assert.deepEqual(parseMediaSample(media), { ...media, artwork: null })
  const artwork = 'data:image/jpeg;base64,/9j/AA=='
  assert.deepEqual(parseMediaSample({ ...media, artwork }), { ...media, artwork })
  for (const invalid of ['https://example.com/cover.jpg', 'file:///cover.png',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,%%%=',
    'data:image/png;base64,' + 'A'.repeat(175000)]) {
    assert.equal(parseMediaSample({ ...media, artwork: invalid })?.artwork, null)
  }
  assert.equal(parseMediaSample({ ...media, title: 'a'.repeat(200) })?.title.length, 150)
})
