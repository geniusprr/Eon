import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopUpdateController } from './DesktopUpdateController.js'

test('download stays in background, duplicate events do not restart it, install requires an explicit ready action', async () => {
  let downloads = 0; let installs = 0
  let finish!: () => void
  const controller = new DesktopUpdateController('2.0.0-preview.2', {
    check: async () => undefined,
    download: () => { downloads++; return new Promise<void>(resolve => { finish = resolve }) },
    install: () => { installs++ },
  }, () => undefined)
  assert.throws(() => controller.install(), /hazır değil/)
  controller.available('2.0.0-preview.3')
  controller.available('2.0.0-preview.3')
  assert.equal(downloads, 1)
  assert.equal(controller.status.phase, 'downloading')
  controller.progress(125)
  assert.equal(controller.status.progress, 100)
  controller.downloaded('2.0.0-preview.3'); finish()
  await new Promise(resolve => setImmediate(resolve))
  await controller.check()
  assert.equal(controller.status.phase, 'downloaded')
  assert.equal(installs, 0)
  controller.install(); controller.install()
  assert.equal(installs, 1)
})

test('failed downloads can retry; development checks do not contact a feed', async () => {
  let fail = true; let checks = 0
  const controller = new DesktopUpdateController('2.0.0', {
    check: async () => { checks++ }, download: async () => { if (fail) throw new Error('offline') }, install: () => undefined,
  }, () => undefined, false)
  await controller.check(); assert.equal(checks, 0)
  controller.available('2.1.0')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(controller.status.phase, 'error')
  fail = false; await controller.download()
  assert.equal(controller.status.phase, 'downloading')
  controller.downloaded('2.1.0'); assert.equal(controller.status.phase, 'downloaded')
})
