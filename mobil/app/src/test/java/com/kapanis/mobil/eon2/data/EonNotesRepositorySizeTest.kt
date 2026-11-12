package com.kapanis.mobil.eon2.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EonNotesRepositorySizeTest {
    private val maxBytes = 5 * 1024 * 1024

    @Test fun asciiBodyAcceptsExactlyFiveMiBAndRejectsOneExtraByte() {
        val atLimit = "a".repeat(maxBytes)
        assertTrue(isNoteBodyWithinLimit(atLimit))
        assertFalse(isNoteBodyWithinLimit(atLimit + "a"))
    }

    @Test fun turkishTextIsCountedAsUtf8BytesRatherThanKotlinCharacters() {
        val atLimit = "ş".repeat(maxBytes / 2) // Two UTF-8 bytes per character.
        assertTrue(isNoteBodyWithinLimit(atLimit))
        assertFalse(isNoteBodyWithinLimit(atLimit + "ş"))
        assertTrue(atLimit.length < maxBytes)
    }

    @Test fun mixedUnicodeAndSurrogatePairsObserveExactByteBoundary() {
        val atLimit = "a".repeat(maxBytes - 7) + "€" + "😀" // 3 + 4 UTF-8 bytes.
        assertTrue(isNoteBodyWithinLimit(atLimit))
        assertFalse(isNoteBodyWithinLimit(atLimit + "a"))

        val emojiAtLimit = "😀".repeat(maxBytes / 4) // Two UTF-16 code units, four UTF-8 bytes.
        assertTrue(isNoteBodyWithinLimit(emojiAtLimit))
        assertFalse(isNoteBodyWithinLimit(emojiAtLimit + "😀"))
    }
}
