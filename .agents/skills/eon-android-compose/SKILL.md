---
name: eon-android-compose
description: Review Eon 2.0 Android Kotlin Compose UI, offline SQLite/Room and device permissions for performance and accessibility.
---

# Eon Android Compose

Read `mobil/app/src/main/java/com/kapanis/mobil/eon2`, Android manifest and Eon Notes wire contract. Compose navigation, local notes, controls and remote viewer must work without network. Use state hoisting, lifecycle-aware work cancellation, IO dispatching, focused recomposition and 48dp accessible targets. Show offline/loading/retry/error/conflict states without lying about capabilities.

Android can contact USB loopback only through ADB reverse, or later an explicitly authenticated TLS tailnet path. Never silently enable accessibility, screen recording, Bluetooth pairing, ADB TCP/IP or legacy Supabase service. Store pairing keys in Android Keystore; allow user-driven revocation. Before acceptance run Gradle lint/unit/instrumented golden tests, Android 9/10 and 14/16, TalkBack, 200% font scaling, rotation, tablet and JankStats/Macrobenchmark. Debug package must not overwrite the legacy Eon app's data.
