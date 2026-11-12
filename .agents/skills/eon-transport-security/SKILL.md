---
name: eon-transport-security
description: Implement or audit Eon USB, tailnet, pairing, authenticated device protocols and scoped permissions.
---

# Eon transport and security

Read `docs/adr/ADR-001-transport.md` and `electron/eon2/transport`. New connection work is limited to authorised USB `adb reverse` and user-configured Tailscale. Check interface/IP, host binding, TLS, user-approved device pairing, per-device secrets, key storage, expiration and revocation. USB ADB trust is transport permission only. No automatic `adb tcpip`, wildcard bind, LAN discovery or public fallback.

Never place code or secrets in logs. All request commands have typed schema, nonce/time window, HMAC or cryptographic peer identity and per-command authorisation; keep permission names granular. Validate disconnected/revoked, oversized, replayed and wrong-vault requests. Use hard failure if TLS certificate identity or tailnet binding cannot be verified. Run tests for host-header and method confusion, wrong serial, invalid nonce, clock drift and reconnect before marking ready.
