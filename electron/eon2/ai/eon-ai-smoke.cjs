// Real Electron bridge/UI smoke with an isolated profile; never uses a real API key.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, shell } = require('electron')

process.env.KAPANIS_SMOKE_TEST = '1'
let runtime
let step = 'startup'

;(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'eon-ai-desktop-smoke-'))
  const desktop = path.join(userData, 'Desktop')
  const programs = path.join(userData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  await fs.mkdir(desktop)
  await fs.mkdir(programs, { recursive: true })
  app.setPath('userData', userData)
  app.setPath('appData', userData)
  app.setPath('desktop', desktop)
  await app.whenReady()
  const appTarget = path.join(process.env.SystemRoot, 'System32', 'notepad.exe')
  assert.equal(shell.writeShortcutLink(path.join(programs, 'Eon QA Editor.lnk'), { target: appTarget }), true)
  const { startEon2Runtime } = await import(pathToFileURL(path.resolve('dist-electron/electron/eon2/Eon2Runtime.js')).href)
  runtime = await startEon2Runtime(path.resolve('dist-electron/electron/eon2/preload.cjs'), pathToFileURL(path.resolve('dist/index.html')).href)
  const window = runtime.windows.getMainWindow()
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('renderer:', message) })
  if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  window.setContentSize(1440, 900)
  window.show()
  const evalJs = source => window.webContents.executeJavaScript(source)
  const settle = () => new Promise(resolve => setTimeout(resolve, 350))
  await settle()
  await evalJs(`document.querySelector('[aria-label="Rehberi kapat"]')?.click()`)
  await settle()

  step = 'home AI bar'
  const dashboard = await evalJs(`(() => {
    const ai = document.querySelector('.eon-ai-home')
    const deck = document.querySelector('.eon-mirror')
    if (!ai || !deck) return null
    const bar = ai.getBoundingClientRect()
    const board = deck.getBoundingClientRect()
    return { label: ai.getAttribute('aria-label'), barTop: bar.top, barBottom: bar.bottom,
      boardBottom: board.bottom, boardWidth: board.width, barWidth: bar.width,
      scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }
  })()`)
  if (!dashboard) {
    console.error('dashboard DOM', await evalJs(`({url: location.href, text: document.body?.innerText?.slice(0, 600),
      aiBar: Boolean(document.querySelector('.eon-ai-home')), studio: Boolean(document.querySelector('.eon-mirror')),
      app: Boolean(document.querySelector('.eon2-app')), root: document.querySelector('#root')?.innerHTML?.slice(0, 700)})`))
  }
  assert.ok(dashboard, 'AI bar or dashboard studio is missing')
  assert.match(dashboard.label, /Eon AI/)
  assert.ok(dashboard.barTop >= dashboard.boardBottom - 1, 'AI bar obscures dashboard')
  assert.ok(dashboard.boardWidth > 400, 'Dashboard collapsed')
  assert.ok(dashboard.scrollWidth <= dashboard.viewport + 1, 'Dashboard has unwanted horizontal overflow')

  step = 'responsive home AI bar'
  const responsive = []
  for (const [width, height] of [[720, 520], [900, 720], [1440, 520], [1440, 900], [1920, 1080], [3840, 2160]]) {
    window.setContentSize(width, height)
    await settle()
    const measurement = await evalJs(`(() => {
      const bar = document.querySelector('.eon-ai-home')?.getBoundingClientRect()
      const stage = document.querySelector('.eon-mirror-stage')?.getBoundingClientRect()
      const phone = document.querySelector('.eon-mirror-phone')?.getBoundingClientRect()
      return bar && stage && phone ? { width: innerWidth, height: innerHeight, barLeft: bar.left, barRight: bar.right,
        barTop: bar.top, barBottom: bar.bottom, stageBottom: stage.bottom,
        phoneWidth: phone.width, phoneHeight: phone.height,
        phoneFits: phone.width > 0 && phone.height > 0 && phone.left >= stage.left - 1 && phone.right <= stage.right + 1 &&
          phone.top >= stage.top - 1 && phone.bottom <= stage.bottom + 1,
        documentWidth: document.documentElement.scrollWidth } : null
    })()`)
    assert.ok(measurement, `AI bar or Deck is hidden at ${width}px`)
    assert.ok(measurement.barLeft >= -1 && measurement.barRight <= measurement.width + 1, `AI bar clips at ${width}px`)
    assert.ok(measurement.documentWidth <= measurement.width + 1, `Horizontal overflow at ${width}px`)
    assert.ok(measurement.phoneFits, `Phone frame clips at ${width}×${height}`)
    assert.ok(measurement.barTop >= measurement.stageBottom - 1 && measurement.barBottom <= measurement.height + 1, `AI bar overlaps or clips at ${width}×${height}`)
    responsive.push(measurement)
  }
  window.setContentSize(1440, 900)
  await settle()

  step = 'AI IPC and section'
  const state = await evalJs(`window.kapanisDesktop.invoke('eon2:ai:state')`)
  assert.equal(state.configured, false)
  assert.ok(typeof state.model === 'string')
  assert.equal(await evalJs(`window.kapanisDesktop.invoke('eon2:ai:pending')`), null)
  await evalJs(`[...document.querySelectorAll('.eon2-nav-item')].find(b => b.title === 'Eon AI').click()`)
  await settle()
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon-ai-chat-history'))`), true)
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon-ai-composer textarea'))`), true)

  step = 'workspace navigation event'
  window.webContents.send('eon2:ai:navigate', 'automations')
  await settle()
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon2-nav-item[title="PC Kısayolları"][aria-current="page"]'))`), true)
  window.webContents.send('eon2:ai:navigate', { section: 'ai' })
  await settle()
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon-ai-chat-history'))`), true)

  step = 'connection settings and secure key isolation'
  await evalJs(`document.querySelector('.eon-ai-chat-header button:last-child').click()`)
  await settle()
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon-ai-account-connect'))`), true)
  assert.equal(await evalJs(`Boolean(document.querySelector('.eon-ai-dialog input[type="password"]'))`), true)
  assert.equal(await evalJs(`document.querySelector('.eon-ai-dialog').textContent.includes('OpenRouter')`), true)
  assert.equal(await evalJs(`'aiApiKey' in (window.kapanisDesktop || {})`), false)

  const output = path.resolve('build/eon-ai-qa')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'ai-settings.png'), (await window.webContents.capturePage()).toPNG())
  await evalJs(`document.querySelector('.eon-ai-dialog header button:last-child').click()`)

  step = 'Windows discovery and shortcut creation through the renderer bridge'
  const originalFetch = globalThis.fetch
  const calls = ['eon', 'windows-desktop', 'windows-desktop'].map((destination, index) => ({
    id: `shortcut-${index}`, type: 'function', function: {
      name: 'eon_shortcuts', arguments: JSON.stringify({ action: 'create', application: 'Eon QA Editor', destination }),
    },
  }))
  calls.push({ id: 'pc-status', type: 'function', function: { name: 'eon_pc', arguments: '{"action":"status"}' } })
  calls.push({ id: 'create-note', type: 'function', function: {
    name: 'eon_notes', arguments: JSON.stringify({ title: 'QA notu', content: 'İlk satır\n\nSon satır.' }),
  } })
  const reasoningDetails = [{ type: 'reasoning.encrypted', data: 'qa-token', index: 0 }]
  let chatRound = 0
  globalThis.fetch = async (url, options) => {
    if (url !== 'https://openrouter.ai/api/v1/chat/completions') return originalFetch(url, options)
    const message = chatRound++ === 0 ? { tool_calls: calls, reasoning_details: reasoningDetails } : { content: 'Eon ve Windows kısayolları hazır.' }
    if (chatRound === 2) {
      const { messages } = JSON.parse(options.body)
      const tools = messages.filter(entry => entry.role === 'tool').map(entry => JSON.parse(entry.content))
      assert.deepEqual(messages.find(entry => entry.role === 'assistant').reasoning_details, reasoningDetails)
      assert.deepEqual(tools.slice(0, 3).map(entry => [entry.ok, entry.result.created]), [[true, true], [true, true], [true, false]])
      assert.ok(tools[3].ok && tools[3].result.memory.totalBytes > 0)
      assert.ok(tools[4].ok && tools[4].result.title === 'QA notu')
    }
    return Response.json({ choices: [{ message }] })
  }
  try {
    await evalJs(`window.kapanisDesktop.invoke('eon2:ai:configure', { apiKey: 'isolated-smoke-key' })`)
    const reply = await evalJs(`window.kapanisDesktop.invoke('eon2:ai:send', { content: 'Eon QA Editor kısayolunu oluştur, Windows masaüstüne de ekle. PC durumunu göster ve QA notunu kaydet.' })`)
    assert.match(reply.reply, /kısayolları hazır/)
    const saved = await evalJs(`window.kapanisDesktop.invoke('eon2:actions:list')`)
    assert.equal(saved.actions.filter(item => item.name === 'Eon QA Editor').length, 1)
    assert.equal(shell.readShortcutLink(path.join(desktop, 'Eon QA Editor.lnk')).target.toLowerCase(), appTarget.toLowerCase())
    const notes = await evalJs(`window.kapanisDesktop.invoke('eon2:notes:list')`)
    assert.equal(notes.find(note => note.title === 'QA notu')?.content, 'İlk satır\n\nSon satır.')

    step = 'AI theme change and live renderer update'
    const beforeTheme = chatRound
    const theme = await evalJs(`(async () => {
      const changed = new Promise((resolve, reject) => {
        const unsubscribe = window.kapanisDesktop.on('eon2:theme:changed', value => {
          clearTimeout(timer)
          unsubscribe()
          resolve(value)
        })
        const timer = setTimeout(() => { unsubscribe(); reject(new Error('Theme event missing')) }, 2000)
      })
      const [response, value] = await Promise.all([
        window.kapanisDesktop.invoke('eon2:ai:send', { content: 'temayı açık yap lütfen' }), changed,
      ])
      return { reply: response.reply, value }
    })()`)
    assert.deepEqual(theme, { reply: 'Aydınlık temayı açtım.', value: 'light' })
    assert.equal(chatRound, beforeTheme)
    assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'eon-2', 'theme.json'), 'utf8')), 'light')
    for (let attempt = 0; attempt < 12; attempt++) {
      if (await evalJs(`Boolean(document.querySelector('.eon2-app.eon2-theme-light'))`)) break
      await settle()
    }
    assert.ok(await evalJs(`Boolean(document.querySelector('.eon2-app.eon2-theme-light'))`))
  } finally {
    globalThis.fetch = originalFetch
  }

  await evalJs(`document.querySelector('.eon2-logo').click()`)
  await settle()
  await fs.writeFile(path.join(output, 'ai-home.png'), (await window.webContents.capturePage()).toPNG())
  console.log('Eon AI Electron smoke PASS', JSON.stringify({ dashboard, responsive, state: { configured: state.configured, model: state.model } }))
  runtime.close()
  app.exit(0)
})().catch(error => {
  console.error(`Eon AI smoke failed during ${step}:`, error)
  try { runtime?.close() } catch { /* preserve original error */ }
  app.exit(1)
})
