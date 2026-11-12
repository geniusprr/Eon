import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const groups = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? discover(file) : /\.test\.(ts|mjs)$/.test(file) ? [file] : []
  }))
  return groups.flat()
}

const tests = (await Promise.all(['electron/eon2', 'src/eon2', 'specs/sync'].map(discover))).flat().sort()
const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', ...tests], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
