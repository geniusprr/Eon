import { createHash } from 'node:crypto'
import type { JsonValue } from './types.js'

/**
 * Deterministic JSON subset: UTF-16 code-unit key ordering (JS/Java), compact
 * JSON string escapes, finite safe integer numbers, UTF-8 and no normalisation.
 * This intentionally excludes floats to avoid cross-language number rendering.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    // Unpaired surrogates have inconsistent UTF-8 handling between runtimes.
    if (/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(value)) {
      throw new Error('Unpaired UTF-16 surrogate in JSON string')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Only safe integer JSON numbers are supported')
    return String(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) throw new Error('Expected a plain JSON object')
    return '{' + Object.keys(value).sort().map(key => canonicalJson(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  throw new Error('Invalid JSON value')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function canonicalSha256(value: JsonValue): string {
  return sha256(canonicalJson(value))
}

export function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('Invalid ' + label)
  }
  canonicalJson(value)
}

export function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Invalid ' + label)
  }
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T
}
