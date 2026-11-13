import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { CompanionUpdater, parseCompanionManifest } from './CompanionUpdater.js'
import { parseAdbDevices, parseCompanionVersion } from '../transport/AdbService.js'

const apk = Buffer.from('verified companion fixture')
const manifest = { schemaVersion: 1, version: '2.0.0-preview.3', android: { version: '2.0.0-preview.3', versionCode: 3,
  packageId: 'com.kapanis.mobil.eon2.dev', size: apk.length, sha256: createHash('sha256').update(apk).digest('hex') } }

test('release identity, hashes and package bounds reject wrong tags, packages and unbounded downloads', () => {
  const parsed = parseCompanionManifest(manifest, 'v2.0.0-preview.3')
  assert.equal(parsed.url, 'https://github.com/geniusprr/Eon/releases/download/v2.0.0-preview.3/Eon-Android-preview.apk')
  for (const android of [{ ...manifest.android, packageId: 'other.app' }, { ...manifest.android, sha256: 'invalid' },
    { ...manifest.android, size: 900 * 1024 * 1024 }, { ...manifest.android, versionCode: -1 }]) {
    assert.throws(() => parseCompanionManifest({ ...manifest, android }, 'v2.0.0-preview.3'))
  }
  assert.throws(() => parseCompanionManifest(manifest, '../untrusted'))
  assert.throws(() => parseCompanionManifest(manifest, 'v2.0.0-preview.4'))
  assert.equal(parseCompanionVersion('versionCode=2 minSdk=26'), 2)
  assert.equal(parseCompanionVersion('Unable to find package'), 0)
})

test('verified background APK automatically updates only an older USB installation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eon-updates-'))
  let installed = 1; let installs = 0; let downloads = 0
  const fetcher: typeof fetch = async input => {
    const url = String(input)
    if (url.includes('api.github.com')) return Response.json([{ tag_name: 'v2.0.0-preview.3', assets: [{ name: 'eon-update.json' }] }])
    if (url.endsWith('eon-update.json')) return Response.json(manifest)
    downloads++; return new Response(apk)
  }
  const service = new CompanionUpdater(directory, {
    list: async () => parseAdbDevices('List of devices attached\nUSB123 device model:Test_Phone\n'),
    companionVersion: async () => installed,
    installCompanion: async () => { installs++; installed = 3 },
  }, true, () => undefined, fetcher)
  try {
    await service.check()
    assert.equal(service.status.phase, 'downloaded'); assert.equal(downloads, 1)
    assert.equal(installs, 1); assert.equal(service.status.devices[0].needsUpdate, false)
    await service.check(); assert.equal(service.status.phase, 'current')
    assert.equal(installs, 1)
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('hash failure never offers or installs an APK, and retry recovers without trusting partial data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eon-update-corrupt-'))
  let corrupt = true; let installs = 0
  const fetcher: typeof fetch = async input => {
    const url = String(input)
    if (url.includes('api.github.com')) return Response.json([{ tag_name: 'v2.0.0-preview.3', assets: [{ name: 'eon-update.json' }] }])
    if (url.endsWith('eon-update.json')) return Response.json(manifest)
    return new Response(corrupt ? Buffer.alloc(apk.length) : apk)
  }
  const service = new CompanionUpdater(directory, {
    list: async () => parseAdbDevices('List of devices attached\nUSB123 device\n'), companionVersion: async () => installs ? 3 : 1,
    installCompanion: async () => { installs++ },
  }, true, () => undefined, fetcher)
  try {
    await service.check(); assert.equal(service.status.phase, 'error'); assert.equal(installs, 0)
    corrupt = false; await service.check(); assert.equal(service.status.phase, 'downloaded'); assert.equal(installs, 1)
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }) }
})
