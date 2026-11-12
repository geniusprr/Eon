import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAction } from '../../../electron/eon2/agent/PcActions'
import type { PcAction } from '../../../shared/eon-controls'
import { actionIsPower, newAction, prepareAction } from './actionForm'

const action = (changes: Partial<PcAction> = {}): PcAction => ({
  id: 'test-shortcut',
  name: ' Test ',
  kind: 'application',
  target: 'C:\\Program Files\\Sample\\Sample.exe',
  arguments: [],
  delaySeconds: 0,
  remoteEnabled: true,
  ...changes,
})

test('application action accepts valid Windows paths and bounded argument arrays', () => {
  const prepared = prepareAction(action(), '["--new-window","C:\\\\Documents"]')
  assert.deepEqual(prepared.arguments, ['--new-window', 'C:\\Documents'])
  assert.equal(prepared.name, 'Test')
  assert.equal(prepared.remoteEnabled, true)
  assert.deepEqual(parseAction(prepared), prepared)
  const unc = prepareAction(action({ target: '\\\\server\\share\\app.exe' }), '[]')
  assert.equal(parseAction(unc).target, '\\\\server\\share\\app.exe')
})

test('invalid command definitions are rejected before IPC', () => {
  assert.throws(() => prepareAction(action({ name: '   ' }), '[]'), /adı/)
  assert.throws(() => prepareAction(action({ target: 'sample.exe' }), '[]'), /tam yolunu/)
  assert.throws(() => prepareAction(action({ target: 'C:\\malware.bat' }), '[]'), /exe/)
  assert.throws(() => prepareAction(action(), '{broken json'), /JSON/)
  assert.throws(() => prepareAction(action(), '{"foo":"bar"}'), /JSON dizisi/)
  assert.throws(() => prepareAction(action(), '["ok",7]'), /JSON dizisi/)
  assert.throws(() => prepareAction(action(), JSON.stringify(Array(33).fill('a'))), /32/)
  assert.throws(() => prepareAction(action(), JSON.stringify(['x'.repeat(2049)])), /2048|32/)
  assert.throws(() => prepareAction(action(), JSON.stringify(['a\0b'])), /JSON dizisi/)
})

test('non-application actions ignore obsolete argument text and clear previous targets', () => {
  const command = prepareAction(action({ kind: 'command', target: ' Write-Output ok ' }), '{invalid')
  assert.equal(command.target, 'Write-Output ok')
  assert.deepEqual(command.arguments, [])
  assert.deepEqual(parseAction(command), command)
  assert.throws(() => prepareAction(action({ kind: 'command', target: '  ' }), '[]'), /komutunu/)
  const lock = prepareAction(action({ kind: 'lock', target: 'bad-previous-target', delaySeconds: 42 }), '{invalid')
  assert.equal(lock.target, '')
  assert.equal(lock.delaySeconds, 0)
  assert.deepEqual(parseAction(lock), lock)
  assert.equal(actionIsPower(lock.kind), true)
})

test('file paths and power delays use server-compatible boundaries', () => {
  assert.equal(parseAction(prepareAction(action({ kind: 'file', target: 'C:\\work\\hello.pdf' }), 'invalid')).kind, 'file')
  assert.throws(() => prepareAction(action({ kind: 'file', target: 'https://example.org/a.txt' }), '[]'), /tam yolunu/)
  assert.throws(() => prepareAction(action({ kind: 'file', target: '\\\\server\\share\\x.txt' }), '[]'), /tam yolunu/)
  for (const delay of [0, -1, 604801, 1.5, NaN]) {
    assert.throws(() => prepareAction(action({ kind: 'shutdown', delaySeconds: delay }), '[]'), /Gecikme|en az 1/)
  }
  const power = prepareAction(action({ kind: 'restart', target: 'stale', delaySeconds: 604800 }), 'bad json')
  assert.equal(power.target, '')
  assert.equal(parseAction(power).delaySeconds, 604800)
  assert.equal(actionIsPower(power.kind), true)
})

test('new desktop actions default to phone-enabled and have valid local defaults', () => {
  const local = newAction('cancel')
  assert.equal(local.remoteEnabled, true)
  assert.equal(local.delaySeconds, 0)
  assert.equal(parseAction({ ...local, name: 'Cancel' }).kind, 'cancel')
  assert.equal(newAction('shutdown').delaySeconds, 60)
})


test('selected icons survive validation and unsupported icons are rejected', () => {
  const prepared = prepareAction(action({ icon: 'gamepad' }), '[]')
  assert.equal(parseAction(prepared).icon, 'gamepad')
  assert.throws(() => parseAction({ ...prepared, icon: '<script>' }), /simge/)
})

test('Windows shortcuts retain their own launch arguments', () => {
  const shortcut = action({ target: 'C:\\Users\\Public\\Desktop\\Game.lnk' })
  assert.equal(parseAction(prepareAction(shortcut, '[]')).kind, 'application')
  assert.throws(() => prepareAction(shortcut, '["--extra"]'), /argüman/)
  assert.throws(() => parseAction({ ...shortcut, arguments: ['--extra'] }), /argüman/)
})
