import assert from 'node:assert/strict'
import { scrcpyArguments } from './ScrcpyManager.js'

assert.deepEqual(scrcpyArguments('ABC012'), ['--serial','ABC012','--max-size','1920','--max-fps','60','--video-bit-rate','8M','--window-title','Eon Android – ABC012'])
assert.deepEqual(scrcpyArguments('V2205', { maxSize: 1280, maxFps: 30, bitRateMbps: 4, turnScreenOff: true }).slice(0, 9), ['--serial', 'V2205', '--max-size', '1280', '--max-fps','30','--video-bit-rate','4M','--window-title'])
assert.deepEqual(scrcpyArguments('V2205', { windowWidth: 580, windowHeight: 268 }).slice(-4),
  ['--window-width', '580', '--window-height', '268'])
for (const serial of ['192.168.1.1:5555', 'ABC;rm -rf', 'ABC DEF', '', '--help']) {
  assert.throws(() => scrcpyArguments(serial))
}
assert.throws(() => scrcpyArguments('ABC', { maxFps: 1000 }))
assert.throws(() => scrcpyArguments('ABC', { bitRateMbps: 0 }))
assert.throws(() => scrcpyArguments('ABC', { maxSize: -1 }))
assert.throws(() => scrcpyArguments('ABC', { windowWidth: 40 }))
assert.throws(() => scrcpyArguments('ABC', { windowHeight: 50000 }))
console.log('Eon scrcpy safe command arguments tests passed')
