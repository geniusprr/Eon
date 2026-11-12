import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { PcActions, parseAction } from './PcActions.js'
import { FileTransfers } from './FileTransfers.js'
import { FILE_CHUNK_BYTES } from '../../../shared/eon-controls.js'

test('first-run shortcuts and new desktop actions are phone-enabled by default', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-action-defaults-'))
  const file = path.join(directory, 'actions.json')
  try {
    const executed: string[] = []
    const store = new PcActions(file, async action => { executed.push(action.id) })
    assert.deepEqual(store.list().map(action => action.id), ['lock', 'shutdown', 'restart', 'cancel'])
    assert.ok(store.list().every(action => action.remoteEnabled === true))
    await store.execute('lock', true)

    const fresh = store.save({ name: 'Yeni kısayol', kind: 'command', target: 'Write-Output ok', arguments: [], delaySeconds: 0 })
    assert.equal(fresh.remoteEnabled, true)
    await store.execute(fresh.id, true)
    assert.deepEqual(executed, ['lock', fresh.id])

    const disabled = store.save({ ...fresh, remoteEnabled: false })
    const { remoteEnabled: _omitted, ...unchangedApproval } = disabled
    const edited = store.save({ ...unchangedApproval, name: 'Düzenlenmiş kısayol' })
    assert.equal(edited.remoteEnabled, false)
    await assert.rejects(store.execute(fresh.id, true), /onaylanmamış/)
    assert.equal(new PcActions(file, async () => {}).list().find(action => action.id === fresh.id)?.remoteEnabled, false)
    assert.throws(() => parseAction(unchangedApproval), /geçersiz/)
    assert.throws(() => store.save({ ...fresh, remoteEnabled: 'true' }), /geçersiz/)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('stored choices survive reopening and phone-created shortcuts are enabled', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-action-stored-'))
  const file = path.join(directory, 'actions.json')
  try {
    await fs.writeFile(file, JSON.stringify([
      { id: 'lock', name: 'Windows kilidi', kind: 'lock', target: '', arguments: [], delaySeconds: 0, remoteEnabled: false },
      { id: 'cancel', name: 'Plan iptali', kind: 'cancel', target: '', arguments: [], delaySeconds: 0, remoteEnabled: true },
    ]))
    const store = new PcActions(file, async () => {})
    assert.deepEqual(store.list().map(action => action.remoteEnabled), [false, true])
    await assert.rejects(store.execute('lock', true), /onaylanmamış/)
    await store.execute('cancel', true)

    const lockedEdit = store.save({ ...store.list()[0], name: 'Kilit düzenlemesi', remoteEnabled: true }, true)
    assert.equal(lockedEdit.remoteEnabled, false)
    const fromPhone = store.save({ id: 'cancel', name: 'Telefon düzenlemesi', kind: 'cancel', target: '', arguments: [], delaySeconds: 0 }, true)
    assert.equal(fromPhone.remoteEnabled, true)
    const createdFromPhone = store.save({ name: 'Telefondan yeni', kind: 'command', target: 'Write-Output new', arguments: [], delaySeconds: 0 }, true)
    assert.equal(createdFromPhone.remoteEnabled, true)
    const reopened = new PcActions(file, async () => {})
    assert.deepEqual(reopened.list().map(action => action.remoteEnabled), [false, true, true])
    await reopened.execute(createdFromPhone.id, true)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('phone edits remain enabled; persistence and command boundaries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-actions-'))
  try {
    const executed: string[] = []
    const store = new PcActions(path.join(directory, 'actions.json'), async action => { executed.push(action.target) })
    const action = store.save({ name: 'Test', kind: 'command', target: 'Write-Output test', arguments: [], delaySeconds: 0, remoteEnabled: true })
    await store.execute(action.id, true)
    store.save({ ...action, target: 'changed', remoteEnabled: true }, true)
    await store.execute(action.id, true)
    assert.deepEqual(executed, ['Write-Output test', 'changed'])
    const restored = new PcActions(path.join(directory, 'actions.json'), async () => {})
    assert.equal(restored.list().find(item => item.id === action.id)?.remoteEnabled, true)
    assert.throws(() => parseAction({ ...action, kind: 'application', target: 'cmd.exe' }))
    assert.equal(parseAction({ ...action, kind: 'file', target: 'C:\\Documents\\not.txt' }).kind, 'file')
    assert.throws(() => parseAction({ ...action, kind: 'file', target: 'https://example.com/not.txt' }))
    assert.throws(() => parseAction({ ...action, arguments: ['a\0b'] }))
    assert.throws(() => parseAction({ ...action, delaySeconds: -1 }))
    assert.throws(() => parseAction({ ...action, id: '../escape' }))
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('bidirectional chunk transfer preserves bytes, ownership, sequence and existing files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-files-'))
  const downloads = path.join(directory, 'received')
  const transfers = new FileTransfers(downloads)
  try {
    const source = randomBytes(FILE_CHUNK_BYTES + 17)
    const sourcePath = path.join(directory, 'source.bin')
    await fs.writeFile(sourcePath, source)
    await assert.rejects(transfers.offer([sourcePath, directory], 'android-device-1'))
    assert.deepEqual(transfers.list(), [])
    await transfers.offer([sourcePath], 'android-device-1')
    const offered = transfers.list('android-device-1')[0]
    await assert.rejects(transfers.chunk('another-device', { id: offered.id, offset: 0 }), /erişim/)
    const first = await transfers.chunk('android-device-1', { id: offered.id, offset: 0 })
    const second = await transfers.chunk('android-device-1', { id: offered.id, offset: FILE_CHUNK_BYTES })
    assert.ok(typeof first.data === 'string' && typeof second.data === 'string')
    assert.deepEqual(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(second.data, 'base64')]), source)
    await transfers.finish('android-device-1', { id: offered.id })

    const inbound = await transfers.prepare('android-device-1', { fileName: 'source.bin', size: source.length })
    await assert.rejects(transfers.finish('android-device-1', inbound), /tamamlanmadı/)
    await assert.rejects(transfers.chunk('android-device-1', { ...inbound, offset: 1, data: 'YQ==' }), /sıra/)
    await transfers.chunk('android-device-1', { ...inbound, offset: 0, data: source.subarray(0, FILE_CHUNK_BYTES).toString('base64') })
    await assert.rejects(transfers.chunk('android-device-1', { ...inbound, offset: 0, data: 'YQ==' }), /sıra/)
    await transfers.chunk('android-device-1', { ...inbound, offset: FILE_CHUNK_BYTES, data: source.subarray(FILE_CHUNK_BYTES).toString('base64') })
    await transfers.finish('android-device-1', inbound)
    await transfers.finish('android-device-1', inbound)
    assert.deepEqual(await fs.readFile(path.join(downloads, `${inbound.id}-source.bin`)), source)
    assert.deepEqual(await fs.readFile(sourcePath), source)
    for (const fileName of ['../escape', 'CON.txt', 'a:b', 'trailing.', 'folder/file']) await assert.rejects(transfers.prepare('android-device-1', { fileName, size: 1 }))
    const empty = await transfers.prepare('android-device-1', { fileName: 'empty.txt', size: 0 })
    await transfers.finish('android-device-1', empty)
    const cancelled = await transfers.prepare('android-device-1', { fileName: 'cancel.txt', size: 5 })
    await transfers.cancel(cancelled.id)
    await assert.rejects(transfers.chunk('android-device-1', { ...cancelled, offset: 0, data: 'YQ==' }))
  } finally { await transfers.close(); await fs.rm(directory, { recursive: true, force: true }) }
})


test('receive directory persists; active transfers and completed files keep their original location', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-file-settings-'))
  const first = path.join(directory, 'app', 'Received')
  const second = path.join(directory, 'chosen')
  const settings = path.join(directory, 'settings', 'transfers.json')
  const transfers = new FileTransfers(first, settings)
  try {
    assert.equal(transfers.getDirectory(), first)
    const pending = await transfers.prepare('android-device-1', { fileName: 'photo.jpg', size: 1 })
    assert.throws(() => transfers.completedPath(pending.id), /hazır değil/)
    await transfers.setDirectory(second)
    assert.equal(new FileTransfers(first, settings).getDirectory(), second)
    await transfers.chunk('android-device-1', { id: pending.id, offset: 0, data: 'YQ==' })
    await transfers.finish('android-device-1', pending)
    assert.equal(path.dirname(transfers.completedPath(pending.id)), first)
    assert.equal(await fs.readFile(transfers.completedPath(pending.id), 'utf8'), 'a')
    const next = await transfers.prepare('android-device-1', { fileName: 'photo.jpg', size: 0 })
    await transfers.finish('android-device-1', next)
    assert.equal(path.dirname(transfers.completedPath(next.id)), second)
    assert.notEqual(transfers.completedPath(next.id), transfers.completedPath(pending.id))
    const blocked = path.join(directory, 'file.txt')
    await fs.writeFile(blocked, 'keep')
    await assert.rejects(transfers.setDirectory(blocked))
    assert.equal(transfers.getDirectory(), second)
    assert.equal(new FileTransfers(first, settings).getDirectory(), second)
    await assert.rejects(transfers.setDirectory('relative-directory'))
    assert.throws(() => transfers.completedPath('../escape'), /hazır değil/)
  } finally { await transfers.close(); await fs.rm(directory, { recursive: true, force: true }) }
})
