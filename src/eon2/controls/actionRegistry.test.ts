import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PcActions } from '../../../electron/eon2/agent/PcActions'
import type { IpcChannel } from '../../../shared/contracts'
import type { PcAction } from '../../../shared/eon-controls'
import { cancelScheduledPower } from './actionRegistry'

function registryIpc(actions: PcActions) {
  return async <T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T> => {
    let result: unknown
    if (channel === 'eon2:actions:save') result = actions.save(payload)
    else if (channel === 'eon2:actions:execute') result = await actions.execute((payload as { id: string }).id)
    else if (channel === 'eon2:actions:delete') result = actions.remove((payload as { id: string }).id)
    else throw new Error('Unexpected IPC: ' + channel)
    return result as T
  }
}

test('cancel power uses default registry shortcut without creating another one', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-power-default-'))
  try {
    const executed: PcAction[] = []
    const actions = new PcActions(path.join(directory, 'actions.json'), async action => { executed.push(action) })
    const before = actions.list()
    await cancelScheduledPower(before, registryIpc(actions))
    assert.deepEqual(actions.list(), before)
    assert.deepEqual(executed.map(action => action.kind), ['cancel'])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('cancel power creates and cleans up an ephemeral action if user deleted default', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-power-missing-'))
  try {
    const executed: PcAction[] = []
    const actions = new PcActions(path.join(directory, 'actions.json'), async action => { executed.push(action) })
    actions.remove('cancel')
    const before = actions.list()
    await cancelScheduledPower(before, registryIpc(actions))
    assert.deepEqual(actions.list(), before)
    assert.equal(executed.length, 1)
    assert.equal(executed[0].kind, 'cancel')
    assert.equal(executed[0].remoteEnabled, false)
    assert.equal(executed[0].name, 'Güç planını iptal et')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('cancel power cleans up temporary registry entry when Windows execution fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-power-failure-'))
  try {
    const actions = new PcActions(path.join(directory, 'actions.json'), async () => { throw new Error('Windows unavailable') })
    actions.remove('cancel')
    const before = actions.list()
    await assert.rejects(cancelScheduledPower(before, registryIpc(actions)), /Windows unavailable/)
    assert.deepEqual(actions.list(), before)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
