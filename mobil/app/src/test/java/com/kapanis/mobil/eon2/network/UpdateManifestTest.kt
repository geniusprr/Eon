package com.kapanis.mobil.eon2.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class UpdateManifestTest {
    private fun manifest(tag: String = "v2.0.0-preview.3", version: String = "2.0.0-preview.3",
        packageId: String = "com.kapanis.mobil.eon2.dev", code: Long = 3, hash: String = "a".repeat(64), size: Long = 1024) =
        UpdateManifest.validate(tag, version, version, packageId, "com.kapanis.mobil.eon2.dev", code, hash, size)

    @Test fun acceptsOnlyTheReleaseOwnedApkAddress() {
        val next = manifest()
        assertEquals(3L, next.versionCode)
        assertEquals("https://github.com/geniusprr/Eon/releases/download/v2.0.0-preview.3/Eon-Android-preview.apk", next.url)
    }
    @Test fun rejectsMismatchedIdentityAndPathInjection() {
        assertThrows(IllegalArgumentException::class.java) { manifest(tag = "../other") }
        assertThrows(IllegalArgumentException::class.java) { manifest(version = "2.0.0") }
        assertThrows(IllegalArgumentException::class.java) { manifest(packageId = "another.app") }
    }
    @Test fun rejectsMissingIntegrityAndUnboundedPayloads() {
        assertThrows(IllegalArgumentException::class.java) { manifest(code = 0) }
        assertThrows(IllegalArgumentException::class.java) { manifest(hash = "broken") }
        assertThrows(IllegalArgumentException::class.java) { manifest(size = 301L * 1024 * 1024) }
    }
}
