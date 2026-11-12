import assert from 'node:assert/strict'
import { parseTailscaleStatus } from './TailscaleDetector.js'

assert.deepEqual(parseTailscaleStatus({}), { installed:true, running:false, online:false, dnsName:null, ipv4:null })
const active = parseTailscaleStatus({ BackendState:'Running', Self: { Online:true, DNSName:'dev.my-tailnet.ts.net.', TailscaleIPs:['100.86.2.3','fd7a:115c:a1e0::1'] } })
assert.equal(active.online, true)
assert.equal(active.ipv4,'100.86.2.3')
assert.equal(active.dnsName,'dev.my-tailnet.ts.net')
for (const ip of ['192.168.1.1','100.63.255.255','100.128.0.1','127.0.0.1','0.0.0.0']) {
  assert.equal(parseTailscaleStatus({ BackendState:'Running', Self: { Online:true, DNSName:'dev.example.ts.net', TailscaleIPs:[ip] } }).online,false)
}
assert.equal(parseTailscaleStatus({BackendState:'NeedsLogin', Self:{Online:true,DNSName:'test.ts.net.',TailscaleIPs:['100.100.1.1']}}).online,false)
console.log('Eon Tailscale interface and DNS validation tests passed')
