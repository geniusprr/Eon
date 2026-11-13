import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import type { ElectronDesktopBridge, IpcChannel } from '../../shared/contracts.js'

function fixture() {
  let bridge: ElectronDesktopBridge | undefined
  const calls: { channel: string; payload: unknown }[] = []
  const source = readFileSync(new URL('./preload.cts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(compiled, {
    exports: {},
    require: (name: string) => {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (key: string, value: ElectronDesktopBridge) => {
          assert.equal(key, 'kapanisDesktop')
          bridge = value
        } },
        ipcRenderer: { invoke: async (channel: string, payload: unknown) => {
          calls.push({ channel, payload })
          return 'forwarded'
        } },
      }
    },
  })
  assert.ok(bridge)
  return { bridge, calls }
}

test('transfer directory and completed-file operations reach their validated main-process handlers', async () => {
  const { bridge, calls } = fixture()
  const channels: IpcChannel[] = [
    'eon2:files:directory', 'eon2:files:choose-directory', 'eon2:files:open-directory',
    'eon2:files:open', 'eon2:files:save-as',
  ]
  for (const channel of channels) {
    const payload = channel === 'eon2:files:open' || channel === 'eon2:files:save-as' ? { id: 'received-file' } : undefined
    assert.equal(await bridge.invoke(channel, payload), 'forwarded')
    assert.equal(calls.at(-1)?.channel, channel)
    assert.equal(calls.at(-1)?.payload, payload)
  }
})

test('transfer access does not expose legacy execution or browser capabilities', async () => {
  const { bridge, calls } = fixture()
  for (const channel of ['launch-program', 'browser:clear-browsing-data'] satisfies IpcChannel[]) {
    await assert.rejects(bridge.invoke(channel, {}), /IPC capability denied/)
  }
  assert.equal(calls.length, 0)
})

test('update center forwards only bounded update operations, not arbitrary downloads or execution', async () => {
  const { bridge, calls } = fixture()
  for (const channel of ['eon2:updates:get', 'eon2:updates:check', 'eon2:updates:download',
    'eon2:updates:install', 'eon2:updates:install-mobile'] satisfies IpcChannel[]) {
    await bridge.invoke(channel, channel.endsWith('install-mobile') ? { serial: 'USB123' } : undefined)
    assert.equal(calls.at(-1)?.channel, channel)
  }
  await assert.rejects(bridge.invoke('launch-program', { path: 'downloaded.exe' }), /IPC capability denied/)
})
