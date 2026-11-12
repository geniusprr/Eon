# Eon 2 development APK device evidence

Observed: 2026-11-11 23:43 +03:00. Development build only; no production release.

## Artifact and reproducibility

- APK: `builds/Eon-2.0-dev-20261111.apk`, 19,180,454 bytes.
- SHA-256: `D5FC03DEE4E33F540C519696D3F18BBB7E397E974AF9CFB74A56B528C35F648B`.
- Package: `com.kapanis.mobil.eon2.dev`; version `1.0.0-eon2` (code 1).
- Source snapshot: `builds/eon2-apk-snapshot-20261111`. The main workspace was being edited concurrently, so this snapshot fixes the inputs to the installed artifact. Only the explicit loopback domain attributes were subsequently copied into it.
- JDK: Android Studio JBR 21.0.5. `JAVA_HOME=C:/Program Files/Android/Android Studio/jbr`; `ANDROID_HOME=C:/Users/Deha/AppData/Local/Android/Sdk`.
- This task changed `mobil/app/build.gradle.kts` to compile SDK 37, as required by the current AndroidX core dependency. It also set `includeSubdomains="false"` for the two loopback domains in `mobil/app/src/main/res/xml/network_security_config.xml`, resolving the two lint errors.
- Other Kotlin/source-set/dependency edits were already in progress in the shared workspace and are not attributed to this task.

## Commands and results

From the source snapshot:

```powershell
.\gradlew.bat '-Dorg.gradle.java.installations.paths=C:/Program Files/Android/Android Studio/jbr' :app:assembleDebug :app:lintDebug :app:connectedDebugAndroidTest --console=plain
```

Exit 0; `BUILD SUCCESSFUL in 32s`. Lint has warnings but no remaining errors. Instrumentation Kotlin/Java tasks report `NO-SOURCE`: this is not evidence of executed automated device test cases.

Earlier `:app:testDebugUnitTest` failed at `:app:compileDebugUnitTestKotlin`: the legacy `RemoteCoordinateMapperTest.kt` references v1 classes excluded from the Eon 2 product source set. Unit tests have not passed and were not suppressed.

Final artifact checks:

- `apksigner.bat verify builds/Eon-2.0-dev-20261111.apk`: exit 0; APK uses a debug signature, not a production signing identity.
- `adb -s 10GCCK012S0007Z install -r builds/Eon-2.0-dev-20261111.apk`: exit 0, `Success`.
- `adb -s 10GCCK012S0007Z reverse tcp:8768 tcp:8768`: exit 0.
- `adb -s 10GCCK012S0007Z shell am start -W -n com.kapanis.mobil.eon2.dev/com.kapanis.mobil.MainActivity`: exit 0, `Status: ok`, cold start 2970 ms. This is a single launch observation, not a performance benchmark.
- Vivo V2205, Android 14. Original `com.kapanis.mobil` and separate Eon 2 development package both remained installed.
- Visual evidence: `builds/eon2-vivo-installed-20261111.png` shows the Eon 2 dashboard, desktop detection and pairing prompt. This screenshot was taken before the final XML-only rebuild; final artifact launch was separately verified above.

## Remaining acceptance

Pairing, note synchronization, reconnect/revoke, remote controls, other Android versions, accessibility and performance acceptance were not completed by this APK task. The detected desktop still requires user pairing. See the broader release gates in `STATUS-20261111.md`.
