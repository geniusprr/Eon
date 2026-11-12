import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EonAiService, type EonAiSecureStorage } from './EonAiService.js'
import { PcActions } from '../agent/PcActions.js'
import { DeckLayoutStore } from '../deck/DeckLayoutStore.js'

const keyStore: EonAiSecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: key => Buffer.from(`protected:${key}`, 'utf8'),
  decryptString: data => {
    const stored = data.toString('utf8')
    if (!stored.startsWith('protected:')) throw new Error('Invalid key')
    return stored.slice('protected:'.length)
  },
}

function fixture(run: (value: {
  storage: string
  actions: PcActions
  layout: DeckLayoutStore
  launchCount: () => number
}) => Promise<void> | void) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-ai-test-'))
  let launches = 0
  const actions = new PcActions(path.join(storage, 'actions.json'), async () => { launches += 1 })
  const layout = new DeckLayoutStore(path.join(storage, 'deck.json'))
  return Promise.resolve().then(() => run({ storage, actions, layout, launchCount: () => launches }))
    .finally(() => fs.rmSync(storage, { recursive: true, force: true }))
}

function response(message: Record<string, unknown>) {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function tool(name: string, args: object) {
  return { id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

const APP_PATH = 'C:\\Program Files\\SampleApp\\SampleApp.exe'

test('clear theme and shortcut requests need zero provider calls', () => fixture(async ({ storage, actions }) => {
  const themes: string[] = []
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    listApplications: async () => [{ name: 'Sample App', path: APP_PATH, source: 'app-paths' }],
    setTheme: async theme => { themes.push(theme) },
    fetcher: async () => { assert.fail('Local commands must not reach OpenRouter') },
  })
  assert.equal((await service.send({ content: 'temayı açık yap lütfen' })).reply, 'Aydınlık temayı açtım.')
  assert.match((await service.send({ content: 'Sample App için kısayol oluştur.' })).reply, /Sample App eklendi/)
  assert.match((await service.send({ content: 'Sample App için kısayol oluştur.' })).reply, /zaten kayıtlı/)
  assert.deepEqual(themes, ['light'])
  assert.equal(actions.list().filter(action => action.name === 'Sample App').length, 1)
}))

test('model can finish verified writes in one request, but read results still go back to the model', () => fixture(async ({ storage, actions }) => {
  let requests = 0
  const themes: string[] = []
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    setTheme: async theme => { themes.push(theme) }, pcStatus: () => ({ cpu: 15 }),
    fetcher: async () => {
      requests++
      if (requests === 1) return response({ tool_calls: [tool('eon_set_theme', { theme: 'light' }), tool('eon_finish', {})] })
      if (requests === 2) return response({ tool_calls: [tool('eon_pc', { action: 'status' }), tool('eon_finish', {})] })
      return response({ content: 'CPU kullanımı %15.' })
    },
  })
  service.configure({ apiKey: 'sample' })
  assert.match((await service.send({ content: 'Görünüm ayarından Aydınlık seçeneğini uygula.' })).reply, /tema.*değiştirildi/)
  assert.equal(requests, 1)
  assert.equal((await service.send({ content: 'PC durumunu bildir.' })).reply, 'CPU kullanımı %15.')
  assert.equal(requests, 3)
  assert.deepEqual(themes, ['light'])
}))

test('AI theme changes use the shared theme values and the existing phone settings permission', () => fixture(async ({ storage, actions }) => {
  const applied: string[] = []
  let round = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    setTheme: async theme => { applied.push(theme) },
    fetcher: async (_url, request) => {
      const payload = JSON.parse(String(request?.body))
      assert.equal(payload.tools.some((item: { function: { name: string } }) => item.function.name === 'eon_set_theme'), round < 2)
      return round++ % 2 === 0 ? response({ tool_calls: [
        tool('eon_set_theme', { theme: 'light' }), tool('eon_set_theme', { theme: 'invalid' }),
      ] }) : response({ content: 'Tema isteği işlendi.' })
    },
  })
  service.configure({ apiKey: 'sample' })
  const allowed = await service.send({ content: 'Görünüm ayarından Aydınlık seçeneğini uygula.' }, { notesWrite: false, systemRead: true })
  assert.match(allowed.actions?.[1] ?? '', /Geçersiz Eon teması/)
  const denied = await service.send({ content: 'Görünüm ayarından Aydınlık seçeneğini uygula.' }, { notesWrite: false, systemRead: false })
  assert.match(denied.actions?.[0] ?? '', /tema değiştirme izni yok/)
  assert.deepEqual(applied, ['light'])
}))

test('resolves a Turkish shortcut request by app name, refreshes discovery and reuses the saved action', () => fixture(async ({ storage, actions }) => {
  const refreshes: boolean[] = []
  const shortcut = 'C:\\Start Menu\\Visual Studio Code.lnk'
  const target = 'C:\\Apps\\Code.exe'
  const desktopWrites: string[] = []
  let ready = false
  let round = 0
  const create = { action: 'create', application: 'VS Code' }
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    listApplications: async (refresh = false) => {
      refreshes.push(refresh)
      ready ||= refresh
      return ready ? [{ name: 'Visual Studio Code', path: shortcut, source: 'start-menu' },
        { name: 'Visual Studio Code', path: target, source: 'app-paths' }] : []
    },
    inspectApplication: () => ({ target, args: '' }),
    createDesktopShortcut: (app, name) => { desktopWrites.push(app.path); return { name: `${name}.lnk`, created: true } },
    fetcher: async () => round++ % 2 === 0
      ? response({ tool_calls: [tool('eon_shortcuts', create), tool('eon_shortcuts', { ...create, destination: 'windows-desktop' })] })
      : response({ content: 'Visual Studio Code kısayolları hazır.' }),
  })
  service.configure({ apiKey: 'sample' })
  await service.send({ content: 'VS Code kısayolu oluştur. Windows masaüstüne de ekle.' })
  await service.send({ content: 'Aynı kısayolları oluştur.' })
  const shortcuts = actions.list().filter(item => item.kind === 'application')
  assert.equal(shortcuts.length, 1)
  assert.equal(shortcuts[0].name, 'Visual Studio Code')
  assert.equal(shortcuts[0].target, shortcut)
  assert.deepEqual(refreshes, [false, true, false, false, false])
  assert.deepEqual(desktopWrites, [shortcut, shortcut])
}))

test('ambiguous app names are reported without saving or guessing a match', () => fixture(async ({ storage, actions }) => {
  let round = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    listApplications: async () => [{ name: 'Visual Studio 2022', path: APP_PATH, source: 'start-menu' },
      { name: 'Visual Studio Code', path: 'C:\\Apps\\Code.exe', source: 'app-paths' }],
    fetcher: async () => round++ === 0
      ? response({ tool_calls: [tool('eon_shortcuts', { action: 'create', application: 'Visual Studio' })] })
      : response({ content: 'Hangi Visual Studio sürümü?' }),
  })
  service.configure({ apiKey: 'sample' })
  const result = await service.send({ content: 'Visual Studio kısayolu oluştur ve sonucu bildir.' })
  assert.match(result.actions?.[0] ?? '', /Birden fazla.*Visual Studio 2022.*Visual Studio Code/)
  assert.equal(actions.list().some(item => item.kind === 'application'), false)
}))

test('phone AI can create a runnable app shortcut and cannot launch disabled shortcuts or bypass notes permission', () => fixture(async ({ storage, actions, launchCount }) => {
  const disabled = actions.save({ name: 'Disabled', kind: 'application', target: APP_PATH, arguments: [], delaySeconds: 0, remoteEnabled: false })
  let round = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    listApplications: async () => [{ name: 'Sample App', path: APP_PATH, source: 'app-paths' }],
    createNote: () => { throw new Error('Unauthorized note write reached repository') },
    fetcher: async (_url, request) => {
      const payload = JSON.parse(String(request?.body))
      assert.ok(!payload.tools.some((tool: { function: { name: string } }) => tool.function.name === 'eon_notes'))
      return round++ === 0 ? response({ tool_calls: [
        tool('eon_shortcuts', { action: 'run', id: disabled.id }),
        tool('eon_shortcuts', { action: 'create', application: 'Sample App' }),
        tool('eon_notes', { title: 'Not', content: 'İçerik' }),
      ] }) : response({ content: 'Sample App kısayolu hazır.' })
    },
  })
  service.configure({ apiKey: 'sample' })
  const result = await service.send({ content: 'Sample App kısayolu oluştur ve sonucu bildir.' }, { notesWrite: false, systemRead: true })
  assert.equal(launchCount(), 0)
  assert.equal(actions.list().find(item => item.name === 'Sample App')?.remoteEnabled, true)
  assert.match(result.actions?.[2] ?? '', /not yazma izni yok/)
}))

test('configuration stores only OS-protected keys and never leaks them in state', () => fixture(({ storage, actions }) => {
  const options = { dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined }
  const service = new EonAiService(options)
  assert.equal(service.state().configured, false)
  assert.equal(service.configure({ model: 'openrouter/free', apiKey: 'sk-or-secret' }).configured, true)
  assert.equal(service.state().model, 'openrouter/free')
  const raw = fs.readFileSync(path.join(storage, 'ai', 'openrouter-settings.json'), 'utf8')
  assert.equal(raw.includes('sk-or-secret'), false)
  assert.equal(raw.includes('encryptedApiKey'), true)
  assert.equal(new EonAiService(options).state().configured, true)
  assert.equal(service.configure({ clearApiKey: true }).configured, false)
  assert.throws(() => service.configure({ model: '../../dangerous' }), /model/)
}))

test('secrets are never written when OS protection is unavailable', () => fixture(({ storage, actions }) => {
  const service = new EonAiService({ dataDir: storage, actions, navigate: () => undefined,
    secureStorage: { ...keyStore, isEncryptionAvailable: () => false } })
  assert.throws(() => service.configure({ apiKey: 'secret-key' }), /Güvenli işletim sistemi/)
  assert.equal(fs.existsSync(path.join(storage, 'ai', 'openrouter-settings.json')), false)
}))

test('live model discovery normalises catalogue, caches it, and survives network failures', () => fixture(async ({ storage, actions }) => {
  let requests = 0
  const options = { dataDir: storage, actions, navigate: () => undefined, secureStorage: keyStore,
    fetcher: (async () => {
      requests += 1
      if (requests !== 1) throw new Error('offline')
      return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }, { id: 'openrouter/free' },
        { id: 'openai/gpt-4o-mini' }, { id: 'invalid ../../' }] }), { status: 200 })
    }) as typeof fetch }
  const service = new EonAiService(options)
  assert.deepEqual((await service.models()).models, ['openai/gpt-4o-mini', 'openrouter/free'])
  assert.deepEqual((await service.models()).models, ['openai/gpt-4o-mini', 'openrouter/free'])
  assert.equal(requests, 1)
  assert.deepEqual((await service.models(true)).models, ['openai/gpt-4o-mini', 'openrouter/free'])
  assert.equal(requests, 2)
  const offline = new EonAiService(options)
  assert.deepEqual((await offline.models()).models, ['openai/gpt-4o-mini', 'openrouter/free'])
}))

test('agent creates trusted shortcuts, renames, edits Deck and navigates through allowlists', () => fixture(async ({ storage, actions, layout, launchCount }) => {
  const opened: string[] = []
  const requests: Array<Record<string, unknown>> = []
  let index = 0
  const toolRounds = [
    [tool('eon_apps', { search: 'sample' })],
    [tool('eon_shortcuts', { action: 'create', name: 'Örnek uygulama', applicationPath: APP_PATH })],
    [tool('eon_shortcuts', { action: 'update', id: 'placeholder', name: 'Yeni ad' })],
    [tool('eon_deck', { action: 'set_shortcuts', quickIds: ['action:placeholder'] })],
    [tool('eon_workspace', { section: 'automations' })],
  ]
  const service = new EonAiService({ dataDir: storage, actions, deckLayout: layout, secureStorage: keyStore,
    navigate: section => { opened.push(section) },
    listApplications: async () => [{ name: 'Sample App', path: APP_PATH, source: 'start-menu' }],
    fetcher: (async (_url, request) => {
      requests.push(JSON.parse(String(request?.body)) as Record<string, unknown>)
      const current = toolRounds[index++]
      if (current) {
        if (index === 3) current[0].function.arguments = JSON.stringify({ action: 'update', id: actions.list().find(item => item.name === 'Örnek uygulama')?.id, name: 'Yeni ad' })
        if (index === 4) current[0].function.arguments = JSON.stringify({ action: 'set_shortcuts', quickIds: [`action:${actions.list().find(item => item.name === 'Yeni ad')?.id}`] })
        return response({ tool_calls: current })
      }
      return response({ content: 'Kısayol oluşturuldu ve yeni ad verildi.' })
    }) as typeof fetch,
  })
  service.configure({ apiKey: 'key-123' })
  const result = await service.send({ content: 'Sample App için kısayol oluştur, adını değiştir ve kısayollar sayfasını aç.' })
  assert.match(result.reply, /Kısayol oluşturuldu/)
  assert.equal(requests.length, 6)
  assert.ok(requests.every(item => !JSON.stringify(item).includes('key-123')))
  const created = actions.list().find(item => item.name === 'Yeni ad')
  assert.ok(created)
  assert.equal(created.kind, 'application')
  assert.equal(created.target, APP_PATH)
  assert.equal(created.remoteEnabled, true)
  assert.deepEqual(layout.get().quickIds, [`action:${created.id}`])
  assert.equal(layout.get().revision, 1)
  assert.deepEqual(opened, ['automations'])
  assert.equal(launchCount(), 0)
  assert.equal(result.actions?.length, 5)
}))

test('agent edits the requested Deck page shortcuts without changing the main panel or other pages', () => fixture(async ({ storage, actions, layout }) => {
  const widgets = layout.get().widgets
  layout.set({ baseRevision: 0, widgets, quickIds: ['tool:explorer'], pages: [
    { id: 'work', name: 'Çalışma', widgets, quickIds: null },
    { id: 'personal', name: 'Kişisel', widgets, quickIds: ['tool:settings'] },
  ] })
  let request = 0
  const service = new EonAiService({ dataDir: storage, actions, deckLayout: layout, secureStorage: keyStore,
    navigate: () => undefined,
    fetcher: (async () => request++ === 0
      ? response({ tool_calls: [tool('eon_deck', { action: 'set_shortcuts', pageId: 'work', quickIds: ['tool:terminal'] })] })
      : response({ content: 'Çalışma ekranının kısayolları güncellendi.' })) as typeof fetch })
  service.configure({ apiKey: 'sk-or-test' })
  const result = await service.send({ content: 'Çalışma ekranının hızlı kısayoluna terminali ekle.' })
  assert.equal(result.actions?.[0], 'eon_deck: başarılı')
  const actual = layout.get()
  assert.equal(actual.revision, 2)
  assert.deepEqual(actual.quickIds, ['tool:explorer'])
  assert.deepEqual(actual.pages?.find(page => page.id === 'work')?.quickIds, ['tool:terminal'])
  assert.deepEqual(actual.pages?.find(page => page.id === 'personal')?.quickIds, ['tool:settings'])
}))

test('model cannot create arbitrary programs or run command shortcuts', () => fixture(async ({ storage, actions }) => {
  const command = actions.save({ name: 'Untrusted', kind: 'command', target: 'Remove-Item C:\\', arguments: [], delaySeconds: 0, remoteEnabled: false })
  const attempts = [tool('eon_shortcuts', { action: 'create', name: 'Wrong', applicationPath: 'C:\\Windows\\System32\\cmd.exe' }),
    tool('eon_shortcuts', { action: 'run', id: command.id }),
    tool('eon_workspace', { section: 'powershell' })]
  let step = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => { throw new Error('unexpected navigation') },
    listApplications: async () => [{ name: 'Sample App', path: APP_PATH, source: 'start-menu' },
      { name: 'Command Prompt', path: 'C:\\Windows\\System32\\cmd.exe', source: 'app-paths' }],
    fetcher: (async () => step++ === 0 ? response({ tool_calls: attempts }) : response({ content: 'İstekler güvenlik nedeniyle reddedildi.' })) as typeof fetch })
  service.configure({ apiKey: 'sample' })
  const result = await service.send({ content: 'Bunları çalıştır' })
  assert.equal(result.actions?.length, 3)
  assert.ok(result.actions?.every(item => item.includes(':') && !item.endsWith('başarılı')))
  assert.equal(actions.list().some(item => item.name === 'Wrong'), false)
}))

test('only installed, argument-free application shortcuts may launch', () => fixture(async ({ storage, actions, launchCount }) => {
  const allowed = actions.save({ name: 'Installed', kind: 'application', target: APP_PATH, arguments: [], delaySeconds: 0, remoteEnabled: false })
  const unknown = actions.save({ name: 'Unlisted', kind: 'application', target: 'C:\\Apps\\unlisted.exe', arguments: [], delaySeconds: 0, remoteEnabled: false })
  const withArguments = actions.save({ name: 'Arguments', kind: 'application', target: APP_PATH, arguments: ['--danger'], delaySeconds: 0, remoteEnabled: false })
  const calls = [tool('eon_shortcuts', { action: 'run', id: unknown.id }), tool('eon_shortcuts', { action: 'run', id: withArguments.id }),
    tool('eon_shortcuts', { action: 'run', id: allowed.id })]
  let sent = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    listApplications: async () => [{ name: 'Sample App', path: APP_PATH, source: 'start-menu' }],
    fetcher: (async () => sent++ === 0 ? response({ tool_calls: calls }) : response({ content: 'Yalnızca kurulu uygulama çalıştırıldı.' })) as typeof fetch })
  service.configure({ apiKey: 'sample' })
  const answer = await service.send({ content: 'Kurulu uygulamayı çalıştır' })
  assert.equal(launchCount(), 1)
  assert.equal(answer.actions?.filter(item => item.endsWith('başarılı')).length, 1)
}))

test('command proposal is pending only; a matching human approval saves but never executes it', () => fixture(async ({ storage, actions, launchCount }) => {
  let now = 1_000_000
  let step = 0
  const command = 'Write-Output "Eon approved"'
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore,
    navigate: () => undefined, now: () => now,
    fetcher: (async () => step++ === 0
      ? response({ tool_calls: [tool('eon_shortcuts', { action: 'propose_command', name: 'Test komutu', command })] })
      : response({ content: 'Komut taslağı onayınızı bekliyor.' })) as typeof fetch })
  service.configure({ apiKey: 'sk-or-test' })
  const baseline = actions.list().length
  const result = await service.send({ content: 'Bana bir komut kısayolu öner.' })
  assert.equal(result.reply, 'Komut taslağı onayınızı bekliyor.')
  assert.equal(actions.list().length, baseline)
  assert.equal(launchCount(), 0)
  const proposal = service.pending()
  assert.ok(proposal)
  assert.match(proposal.id, /^[a-f0-9-]{36}$/i)
  assert.deepEqual({ name: proposal.name, command: proposal.command, expiresAt: proposal.expiresAt },
    { name: 'Test komutu', command, expiresAt: now + 10 * 60_000 })
  assert.notEqual(service.pending(), proposal, 'pending returns a copy')
  assert.throws(() => service.approve('not-the-id'), /bulunamadı/)
  assert.equal(service.reject('not-the-id'), false)
  assert.deepEqual(service.pending(), proposal)
  const approved = service.approve(proposal.id)
  assert.equal(approved.name, 'Test komutu')
  assert.equal(approved.kind, 'command')
  assert.equal(approved.target, command)
  assert.equal(approved.remoteEnabled, true)
  assert.deepEqual(approved.arguments, [])
  assert.equal(approved.delaySeconds, 0)
  assert.equal(actions.list().length, baseline + 1)
  assert.equal(launchCount(), 0)
  assert.equal(service.pending(), null)
  assert.throws(() => service.approve(proposal.id), /bulunamadı/)
  assert.equal(service.reject(proposal.id), false)
  now += 5_000
}))

test('command proposal expires, rejects stale IDs, and cannot be approved by model tools', () => fixture(async ({ storage, actions, launchCount }) => {
  let now = 2_000_000
  const proposals = [
    tool('eon_shortcuts', { action: 'propose_command', name: 'İlk komut', command: 'Write-Output 1' }),
    tool('eon_shortcuts', { action: 'approve', id: 'forged-id' }),
    tool('eon_shortcuts', { action: 'propose_command', name: 'İkinci komut', command: 'Write-Output 2' }),
  ]
  let call = 0
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore,
    navigate: () => undefined, now: () => now,
    fetcher: (async () => call++ % 2 === 0
      ? response({ tool_calls: [proposals[Math.floor((call - 1) / 2)]] })
      : response({ content: 'İnceleme gerekiyor.' })) as typeof fetch })
  service.configure({ apiKey: 'sk-or-test' })
  const baseline = actions.list().length
  await service.send({ content: 'İlk komut taslağını oluştur' })
  const first = service.pending()
  assert.ok(first)
  assert.equal(actions.list().length, baseline)

  // The model may know the genuine pending ID, but the tool dispatch has no approval action.
  proposals[1].function.arguments = JSON.stringify({ action: 'approve', id: first.id })
  const selfApproval = await service.send({ content: 'AI kendi kendine komutu onaylasın' })
  assert.ok(selfApproval.actions?.every(item => !item.endsWith('başarılı')))
  assert.deepEqual(service.pending(), first)
  assert.equal(actions.list().length, baseline)

  await service.send({ content: 'Yeni bir komut taslağı oluştur' })
  const second = service.pending()
  assert.ok(second)
  assert.notEqual(second.id, first.id)
  assert.equal(service.reject(first.id), false)
  assert.throws(() => service.approve(first.id), /bulunamadı/)
  assert.equal(service.pending()?.id, second.id)

  now = second.expiresAt - 1
  assert.equal(service.pending()?.id, second.id)
  now += 1
  assert.equal(service.pending(), null)
  assert.throws(() => service.approve(second.id), /doldu/)
  assert.equal(service.reject(second.id), false)
  assert.equal(actions.list().length, baseline)
  assert.equal(launchCount(), 0)
}))

test('reject dismisses pending command and expired commands do not survive restart', () => fixture(async ({ storage, actions }) => {
  let call = 0
  const options = { dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined,
    fetcher: (async () => call++ % 2 === 0
      ? response({ tool_calls: [tool('eon_shortcuts', { action: 'propose_command', name: 'Geçici', command: 'Write-Output safe' })] })
      : response({ content: 'Onayınızı bekliyorum.' })) as typeof fetch }
  const service = new EonAiService(options)
  service.configure({ apiKey: 'sk-or-test' })
  await service.send({ content: 'Öner' })
  const proposal = service.pending()
  assert.ok(proposal)
  assert.equal(new EonAiService(options).pending(), null, 'pending proposals are deliberately not persisted')
  assert.equal(service.reject(proposal.id), true)
  assert.equal(service.pending(), null)
  assert.throws(() => service.approve(proposal.id), /bulunamadı/)
}))

test('model aliases beginning with ~ are accepted in OpenRouter model configuration', () => fixture(({ storage, actions }) => {
  const service = new EonAiService({ dataDir: storage, actions, secureStorage: keyStore, navigate: () => undefined })
  assert.equal(service.configure({ model: '~openai/gpt-sol-latest' }).model, '~openai/gpt-sol-latest')
  assert.throws(() => service.configure({ model: '~~openai/gpt-sol-latest' }), /model/)
}))
