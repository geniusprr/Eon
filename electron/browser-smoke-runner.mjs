import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const port = 4179
const icon = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#60a5fa"/></svg>')
const smokePage = `<!doctype html><html><head><meta charset="utf-8"><title>Eon smoke</title><link rel="icon" href="data:image/svg+xml,${icon}"><style>
  :root { color-scheme: light dark; }
  html, body { width: 100%; height: 100%; margin: 0; background: rgb(25, 104, 217); color: white; font: 16px system-ui; }
  main { padding: 32px; }
  @media (prefers-color-scheme: dark) { html, body { background: rgb(22, 30, 45); } }
</style></head><body><main>Eon browser lifecycle smoke test</main></body></html>`

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (requestUrl.pathname === '/page') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(smokePage)
    return
  }
  if (requestUrl.pathname === '/download.txt') {
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="kapanis-smoke.txt"',
    })
    response.end('kapanis smoke download')
    return
  }
  const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, '')
  const filePath = path.resolve(dist, relative)
  if (filePath !== dist && !filePath.startsWith(dist + path.sep)) {
    response.writeHead(400); response.end('bad path'); return
  }
  try {
    const body = await readFile(filePath)
    response.writeHead(200, { 'content-type': contentType(filePath) })
    response.end(body)
  } catch {
    response.writeHead(404); response.end('not found')
  }
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'kapanis-browser-smoke-'))
try {
  const electronBinary = require('electron')
  const child = spawn(electronBinary, ['.', `--user-data-dir=${profileDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_START_URL: `http://127.0.0.1:${port}/`, KAPANIS_SMOKE_TEST: '1', KAPANIS_SMOKE_URL: `http://127.0.0.1:${port}` },
  })

  const result = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  if (result.code !== 0) throw new Error(`Electron browser smoke testi başarısız: ${result.code ?? result.signal}`)
  console.log('[browser-smoke-runner] başarılı')
} finally {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
  await rm(profileDir, { recursive: true, force: true })
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return extension === '.html' ? 'text/html; charset=utf-8'
    : extension === '.js' ? 'text/javascript; charset=utf-8'
    : extension === '.css' ? 'text/css; charset=utf-8'
      : extension === '.svg' ? 'image/svg+xml'
        : extension === '.woff2' ? 'font/woff2'
          : 'application/octet-stream'
}
