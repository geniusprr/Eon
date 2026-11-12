package com.kapanis.mobil.eon2.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class NotesWordCountTest {
    @Test fun emptyAndWhitespaceOnlyNotesHaveNoWords() {
        assertEquals(0, countNoteWords(""))
        assertEquals(0, countNoteWords("  \t\r\n  "))
    }

    @Test fun markdownAndMultilingualTextCountDelimitedTokens() {
        assertEquals(6, countNoteWords("# Başlık\n- [x] önemli görev\n"))
        assertEquals(3, countNoteWords("merhaba\t世界\nhello"))
        assertEquals(2, countNoteWords("bir\u00A0iki"))
    }

    @Test fun largeNotesCountWithoutAllocatingPerWord() {
        assertEquals(50_000, countNoteWords("not \n".repeat(50_000)))
    }
}
