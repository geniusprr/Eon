import { createHash } from 'node:crypto'
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises'

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const metadata = JSON.parse(await readFile('build/mobile/version.json', 'utf8'))
if (metadata.applicationId !== 'com.kapanis.mobil.eon2.dev' || metadata.versionName !== pkg.version || !Number.isSafeInteger(metadata.versionCode)) {
  throw new Error('Android ve Desktop sürümlerini birlikte artırın. APK sürümü/yayın kimliği eşleşmiyor.')
}
await copyFile('build/mobile/Eon-Android.apk', 'release/Eon-Android-preview.apk')
const apk = await readFile('release/Eon-Android-preview.apk')
if (createHash('sha256').update(apk).digest('hex') !== metadata.sha256) throw new Error('Hazırlanan Android APK bütünlüğü değişti.')
const manifest = { schemaVersion: 1, version: pkg.version, android: { version: pkg.version,
  versionCode: metadata.versionCode, packageId: metadata.applicationId, size: apk.length,
  sha256: createHash('sha256').update(apk).digest('hex') } }
await writeFile('release/eon-update.json', JSON.stringify(manifest, null, 2) + '\n')
const assets = [`Eon-Setup-${pkg.version}.exe`, `Eon-Setup-${pkg.version}.exe.blockmap`,
  'Eon-Android-preview.apk', 'latest.yml', 'eon-update.json']
const lines = []
for (const file of assets) {
  if (!(await stat(`release/${file}`)).isFile()) throw new Error(`Eksik yayın dosyası: ${file}`)
  lines.push(`${createHash('sha256').update(await readFile(`release/${file}`)).digest('hex')}  ${file}`)
}
await writeFile('release/SHA256SUMS.txt', lines.join('\n') + '\n')
console.log(`Eon ${pkg.version}: Desktop + Android güncelleme manifesti hazır.`)
