package com.kapanis.mobil.eon2.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckLayoutModelTest {
    @Test fun defaultCanvasMatchesDesktopAndDoesNotOverlap() {
        val widgets = DeckLayout.defaults().widgets
        assertTrue(validDeckWidgets(widgets))
        assertEquals(listOf("clock", "cpu", "gpu", "ram", "disk", "media", "shortcuts"), widgets.map { it.id })
        assertEquals(DeckWidget("clock", 0, 0, 4, 2, true), widgets[0])
        assertEquals(DeckWidget("media", 0, 2, 4, 4, true), widgets[5])
        assertEquals(DeckWidget("shortcuts", 4, 3, 8, 3, true), widgets[6])
    }

    @Test fun rejectsOverflowAndOverlappingWidgets() {
        val widgets = DeckLayout.defaults().widgets
        assertNull(changeDeckWidget(widgets, widgets[0].copy(w = 13)))
        assertNull(changeDeckWidget(widgets, widgets[0].copy(w = 1))) // PC requires at least 2×2 clock.
        assertNull(changeDeckWidget(widgets, widgets[5].copy(w = 2))) // Media must be at least 3×2.
        assertNull(changeDeckWidget(widgets, widgets[0].copy(x = -1)))
        assertNull(changeDeckWidget(widgets, widgets[0].copy(h = 4)))
        assertFalse(validDeckWidgets(widgets + widgets[0]))
    }

    @Test fun hiddenWidgetsCanMoveButMustFitWhenShown() {
        val widgets = DeckLayout.defaults().widgets
        val hidden = changeDeckWidget(widgets, widgets[0].copy(visible = false))
        assertNotNull(hidden)
        val relocated = changeDeckWidget(hidden!!, hidden[0].copy(x = 8, y = 0))
        assertNotNull(relocated)
        assertNull(changeDeckWidget(relocated!!, relocated[0].copy(visible = true)))
        // Desktop allows hidden panels to keep an off-canvas origin until they are shown again.
        val offscreen = changeDeckWidget(relocated, relocated[0].copy(x = 12))
        assertNotNull(offscreen)
        assertNull(changeDeckWidget(offscreen!!, offscreen[0].copy(visible = true)))
    }

    @Test fun adjacentGaugesSwapWithoutCollision() {
        val widgets = DeckLayout.defaults().widgets
        val updated = changeDeckWidget(widgets, widgets[1].copy(x = 5))
        assertNotNull(updated)
        assertTrue(validDeckWidgets(updated!!))
        assertEquals(6, updated.first { it.id == "cpu" }.x)
        assertEquals(4, updated.first { it.id == "gpu" }.x)
    }

    @Test fun oldPollNeverOverwritesNewestSavedRevision() {
        val current = DeckLayout.defaults().copy(revision = 7)
        val server = DeckLayout.defaults().copy(revision = 8)
        assertFalse(isNewerDeckRevision(current.copy(revision = 6), current, server))
        assertFalse(isNewerDeckRevision(current.copy(revision = 7), current, server))
        assertTrue(isNewerDeckRevision(current.copy(revision = 8), current, server))
        // A fresh process must trust its first authenticated PC response even if old
        // locally cached layout data came from a previously reinitialised PC store.
        assertTrue(isNewerDeckRevision(current.copy(revision = 0), current, null))
    }

    @Test fun customPageEditsPreserveOtherPagesAndBaseWidgets() {
        val base = DeckLayout.defaults()
        val work = DeckPage("work-1", "Çalışma", base.widgets, listOf("tool:explorer"))
        val media = DeckPage("music-1", "Medya", base.widgets, listOf("tool:settings"))
        val layout = base.copy(revision = 3, pages = listOf(work, media), pagesSpecified = true)
        val nextWidgets = changeDeckWidget(work.widgets, work.widgets[0].copy(visible = false))!!
        val nextPages = layout.pages.map { page -> if (page.id == work.id) page.copy(widgets = nextWidgets) else page }
        assertEquals(base.widgets, layout.widgets)
        assertEquals(media, nextPages[1])
        assertFalse(nextPages[0].widgets.first().visible)
        assertTrue(validDeckWidgets(nextPages[0].widgets))
    }
}
