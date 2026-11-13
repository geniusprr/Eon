import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CompanionInstaller } from './CompanionInstaller.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('installs a missing companion only once even when retry overlaps', async () => {
  let installs = 0
  let finish!: () => void
  const wait = new Promise<void>(resolve => { finish = resolve })
  const installer = new CompanionInstaller({
    companionInstalled: async () => false,
    companionVersion: async () => 0,
    installCompanion: async (_serial, apk) => { assert.equal(apk, 'bundled.apk'); installs++; await wait },
    openCompanion: async () => { throw new Error('unexpected launch') },
  }, 'bundled.apk')
  const first = installer.ensure('usb')
  const second = installer.ensure('usb')
  await Promise.resolve()
  assert.equal(installer.status('usb')?.phase, 'installing')
  assert.equal(installs, 1)
  finish()
  await Promise.all([first, second])
  assert.equal(installer.status('usb'), null)
})

test('updates an older installed companion from the bundled APK without downgrading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eon-bundled-'))
  let version = 1; let installs = 0; let opens = 0
  try {
    await writeFile(path.join(dir, 'version.json'), JSON.stringify({ applicationId: 'com.kapanis.mobil.eon2.dev', versionCode: 2 }))
    const installer = new CompanionInstaller({
      companionInstalled: async () => true,
      companionVersion: async () => version,
      installCompanion: async () => { installs++; version = 2 },
      openCompanion: async () => { opens++ },
    }, path.join(dir, 'Eon-Android.apk'))
    await installer.ensure('usb')
    assert.equal(installs, 1)
    version = 3
    await installer.ensure('usb')
    assert.equal(installs, 1)
    assert.equal(opens, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('opens an existing companion and exposes failures for retry', async () => {
  let fail = true
  let installs = 0
  const installer = new CompanionInstaller({
    companionInstalled: async () => true,
    companionVersion: async () => 1,
    installCompanion: async () => { installs++ },
    openCompanion: async () => { if (fail) throw new Error('USB disconnected') },
  }, 'bundled.apk')
  await assert.rejects(installer.ensure('usb'), /USB disconnected/)
  assert.equal(installer.status('usb')?.phase, 'error')
  fail = false
  await installer.ensure('usb')
  assert.equal(installs, 0)
  assert.equal(installer.status('usb'), null)
})
