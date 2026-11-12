import path from 'node:path'
import type { ProgramCandidate } from '../../../shared/contracts.js'

const EXECUTION_HOSTS = /^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|reg|schtasks|wmic|msiexec|certutil|bitsadmin|taskkill|bash|wsl|wt)\.(?:exe|lnk)$/i
const EXECUTION_HOST_NAMES = /^(?:command prompt|windows powershell|powershell(?: \d+)?|terminal|windows terminal|komut istemi)$/i
const applicationNames = [
  ['visual studio code', 'vs code', 'vscode', 'code'],
  ['google chrome', 'chrome'], ['microsoft edge', 'edge', 'msedge'], ['mozilla firefox', 'firefox'],
  ['not defteri', 'notepad'], ['hesap makinesi', 'calculator', 'calc'],
]

export function localExecutable(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) && /\.exe$/i.test(value) && !EXECUTION_HOSTS.test(path.win32.basename(value))
}

export function installedCandidate(app: ProgramCandidate): boolean {
  return (app.source === 'start-menu' || app.source === 'app-paths') && /^[a-z]:[\\/]/i.test(app.path) &&
    /\.(exe|lnk)$/i.test(app.path) && !EXECUTION_HOSTS.test(path.win32.basename(app.path)) && !EXECUTION_HOST_NAMES.test(app.name.trim())
}

export function applicationPathKey(value: string): string {
  return path.win32.normalize(value).toLowerCase()
}

function words(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function matchApplications(apps: readonly ProgramCandidate[], query: string) {
  const term = words(query.replace(/\.(exe|lnk)$/i, ''))
  if (!term) return []
  const terms = applicationNames.find(names => names.includes(term)) ?? [term]
  return apps.flatMap(app => {
    const name = words(app.name)
    const filename = words(path.win32.parse(app.path).name)
    const score = terms.includes(name) ? 3 : terms.includes(filename) ? 2
      : terms.some(item => item.split(' ').every(token => name.split(' ').includes(token))) ? 1 : 0
    return score ? [{ app, score }] : []
  }).sort((left, right) => right.score - left.score)
}
