# ADR-001: Eon 2.0 connection transports and device identity

**Status:** Accepted architecture; USB implementation under test; tailnet implementation pending. **Date:** 2026-11-11.

Only (a) user-authorised Android Debug Bridge USB reverse and (b) a user-supplied Tailscale tailnet are valid transports. Never bind the USB HTTP listener to `0.0.0.0`. No general LAN discovery, public relay, Supabase, ngrok, cloud queue or open port fallback. Tailscale may use its own coordinator/DERP; Eon itself is not a cloud host.

USB runtime maps Android loopback port 8768 to a separate desktop loopback listener per authorised ADB serial. The initiating device requests pairing and only the other device accepts or rejects. Approval expires after two minutes and is invalidated when the USB tunnel disappears. The phone holds a random request token and collects the pairing credential only after acceptance on the matching tunnel. Credentials are stored with Android Keystore and Windows encrypted storage. Subsequent calls retain HMAC-SHA256 over method, path, timestamp, nonce and exact body hash. Pairing approval is unavailable on Tailscale. Android USB debugging and the Android system trust prompt are transport prerequisites.

Paired phones can read shared settings and update the theme with authenticated requests. Writing the Windows login and Tailscale switches from a phone requires its USB tunnel. Desktop settings use the same values.

Logical identity is a stable device ID independent of serial/IP, paired to the shared vault. Scoped permissions: `system.read`, `notes.read`, `notes.write` are current; `remote.view`, `remote.control`, `actions.execute`, `power.manage`, `files.transfer` require separate consent, short sessions and enforcement. A single logical session should survive USB/Tailscale path changes without command replay. ADB wireless is out of first-release scope and must never turn on automatically.

**Open tailnet design:** Select an explicit Tailscale interface address after verifying the local Tailscale agent and peer; bind HTTPS on that address and enforce validated server identity and application-level device authentication/ACL. Never reuse USB cleartext HTTP over a tailnet IP or accept wildcard host headers. Certificate issuance, renewal and trust enrollment require a separate design/test gate; interface presence alone never means a usable tunnel.

**Negative acceptance:** unauthenticated/revoked call, replayed signature, duplicate nonce, invalid host/serial, oversized JSON, 2 connected phones, adb restart, code expiry, cable removal, clock skew, account identity change, Tailscale VPN disconnected. Logs must not contain secrets or private Markdown content.
