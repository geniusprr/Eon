import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const android = path.join(root, 'mobil')
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK before packaging Eon.')

const build = spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat', ':app:assembleDebug', '--console=plain', ...process.argv.slice(2)], {
  cwd: android,
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const output = path.join(android, 'app', 'build', 'outputs', 'apk', 'debug')
const metadata = JSON.parse(await readFile(path.join(output, 'output-metadata.json'), 'utf8'))
if (metadata.applicationId !== 'com.kapanis.mobil.eon2.dev' || metadata.elements?.length !== 1 || metadata.elements[0].outputFile !== 'app-debug.apk') {
  throw new Error('Unexpected Android APK output. The companion must use the isolated Eon 2 development package.')
}

const resources = path.join(root, 'build', 'mobile')
await mkdir(resources, { recursive: true })
const platformTools = path.join(sdk, 'platform-tools')
for (const file of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll', 'NOTICE.txt']) {
  await copyFile(path.join(platformTools, file), path.join(resources, file))
}
await copyFile(path.join(output, 'app-debug.apk'), path.join(resources, 'Eon-Android.apk'))
const apk = await readFile(path.join(resources, 'Eon-Android.apk'))
await writeFile(path.join(resources, 'version.json'), JSON.stringify({ applicationId: metadata.applicationId,
  ...metadata.elements[0], sha256: createHash('sha256').update(apk).digest('hex') }, null, 2))
