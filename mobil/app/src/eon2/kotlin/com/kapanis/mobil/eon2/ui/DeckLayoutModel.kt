package com.kapanis.mobil.eon2.ui

import org.json.JSONArray
import org.json.JSONObject

internal const val DECK_COLUMNS = 12
internal const val DECK_ROWS = 6

internal val DECK_WIDGET_IDS = listOf("clock", "cpu", "gpu", "ram", "disk", "media", "shortcuts")
private val DECK_MINIMUM = mapOf(
    "clock" to (2 to 2), "cpu" to (1 to 2), "gpu" to (1 to 2),
    "ram" to (1 to 2), "disk" to (1 to 2), "media" to (3 to 2),
    "shortcuts" to (3 to 2),
)

internal data class DeckWidget(val id: String, val x: Int, val y: Int, val w: Int, val h: Int, val visible: Boolean) {
    fun intersects(other: DeckWidget): Boolean =
        visible && other.visible && x < other.x + other.w && other.x < x + w &&
            y < other.y + other.h && other.y < y + h

    fun fits(): Boolean {
        val minimum = DECK_MINIMUM[id] ?: return false
        return x in 0..DECK_COLUMNS && y in 0..DECK_ROWS &&
            w in minimum.first..DECK_COLUMNS && h in minimum.second..DECK_ROWS &&
            (!visible || (x + w <= DECK_COLUMNS && y + h <= DECK_ROWS))
    }

    fun toJson(): JSONObject = JSONObject().put("id", id).put("x", x).put("y", y)
        .put("w", w).put("h", h).put("visible", visible)
}

internal data class DeckPage(val id: String, val name: String, val widgets: List<DeckWidget>, val quickIds: List<String>?) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name)
        .put("widgets", widgetsToJson(widgets)).put("quickIds", quickIds?.let { JSONArray(it) } ?: JSONObject.NULL)
}

internal data class DeckLayout(val revision: Int, val updatedAt: Long, val widgets: List<DeckWidget>,
    val quickIds: List<String>? = null, val quickIdsSpecified: Boolean = false, val pages: List<DeckPage> = emptyList(),
    val pagesSpecified: Boolean = false, val hideShortcutNames: Boolean = false,
    val shortcutIds: List<String>? = null) {
    fun toJson(): String = JSONObject().put("version", 1).put("revision", revision)
        .put("updatedAt", updatedAt).put("hideShortcutNames", hideShortcutNames).put("widgets", widgetsToJson(widgets)).also { json ->
            shortcutIds?.let { json.put("shortcutIds", JSONArray(it)) }
            if (pagesSpecified || pages.isNotEmpty()) json.put("pages", pagesToJson(pages))
            if (quickIdsSpecified) json.put("quickIds", quickIds?.let { JSONArray(it) } ?: JSONObject.NULL)
        }.toString()

    companion object {
        fun defaults(): DeckLayout = DeckLayout(0, 0L, listOf(
            DeckWidget("clock", 0, 0, 4, 2, true),
            DeckWidget("cpu", 4, 0, 2, 3, true),
            DeckWidget("gpu", 6, 0, 2, 3, true),
            DeckWidget("ram", 8, 0, 2, 3, true),
            DeckWidget("disk", 10, 0, 2, 3, true),
            DeckWidget("media", 0, 2, 4, 4, true),
            DeckWidget("shortcuts", 4, 3, 8, 3, true),
        ))

        fun parse(source: JSONObject, allowPages: Boolean = true): DeckLayout {
            require(source.getInt("version") == 1) { "Panel sürümü desteklenmiyor." }
            val revision = source.getInt("revision")
            val updatedAt = source.getLong("updatedAt")
            require(revision >= 0 && updatedAt >= 0) { "Panel revizyonu geçersiz." }
            val raw = source.getJSONArray("widgets")
            require(raw.length() == DECK_WIDGET_IDS.size) { "Panel bileşen sayısı uyuşmuyor." }
            val widgets = (0 until raw.length()).map { index ->
                val item = raw.getJSONObject(index)
                DeckWidget(item.getString("id"), item.getInt("x"), item.getInt("y"),
                    item.getInt("w"), item.getInt("h"), item.getBoolean("visible"))
            }
            require(widgets.map { it.id }.toSet() == DECK_WIDGET_IDS.toSet()) { "Panel bileşenleri tanınmıyor." }
            require(validDeckWidgets(widgets)) { "Panel bileşenleri çakışıyor veya sınırı aşıyor." }
            val hasQuickIds = source.has("quickIds")
            val quickIds = if (!hasQuickIds || source.isNull("quickIds")) null else {
                val list = source.getJSONArray("quickIds")
                require(list.length() <= 6) { "Hızlı tuş sınırı aşılıyor." }
                (0 until list.length()).map { index -> list.getString(index) }.also { ids ->
                    require(ids.size == ids.distinct().size && ids.all { id ->
                        id.length in 3..150 && (id.startsWith("tool:") || id.startsWith("action:"))
                    }) { "Panel kısayolları geçersiz." }
                }
            }
            val hasPages = source.has("pages")
            val pages = if (!hasPages) emptyList() else {
                require(allowPages) { "İç içe ekran desteklenmiyor." }
                val rawPages = source.getJSONArray("pages")
                (0 until rawPages.length()).map { index ->
                    val page = rawPages.getJSONObject(index)
                    val id = page.getString("id")
                    val name = page.getString("name")
                    require(id.matches(Regex("[a-zA-Z0-9-]{1,90}")) && id !in listOf("panel", "keys") && name.isNotBlank() && name.length <= 80)
                    val parsed = parse(JSONObject().put("version", 1).put("revision", revision).put("updatedAt", updatedAt)
                        .put("widgets", page.getJSONArray("widgets")).put("quickIds", page.get("quickIds")), false)
                    DeckPage(id, name, parsed.widgets, parsed.quickIds)
                }.also { require(it.map { page -> page.id }.distinct().size == it.size) }
            }
            require(!source.has("hideShortcutNames") || source.get("hideShortcutNames") is Boolean)
            val shortcutIds = if (source.isNull("shortcutIds")) null else {
                val list = source.getJSONArray("shortcutIds")
                val pattern = Regex("(?:tool:(?:explorer|terminal|tasks|settings)|action:[a-zA-Z0-9-]{1,90})")
                (0 until list.length()).map { index -> (list.get(index) as? String ?: error("Geçersiz kısayol.")) }
                    .also { ids -> require(ids.toSet().size == ids.size && ids.all(pattern::matches)) }
            }
            return DeckLayout(revision, updatedAt, widgets, quickIds, hasQuickIds, pages, hasPages,
                source.optBoolean("hideShortcutNames", false), shortcutIds)
        }
    }
}

internal fun widgetsToJson(widgets: List<DeckWidget>): JSONArray = JSONArray().apply {
    widgets.forEach { put(it.toJson()) }
}

internal fun pagesToJson(pages: List<DeckPage>): JSONArray = JSONArray().apply {
    pages.forEach { put(it.toJson()) }
}

/** A stale response from an older in-flight poll may never override a completed local save. */
internal fun isNewerDeckRevision(candidate: DeckLayout, current: DeckLayout, remote: DeckLayout?): Boolean =
    remote == null || candidate.revision >= maxOf(current.revision, remote.revision)

internal fun validDeckWidgets(widgets: List<DeckWidget>): Boolean =
    widgets.size == DECK_WIDGET_IDS.size && widgets.map { it.id }.toSet() == DECK_WIDGET_IDS.toSet() &&
        widgets.all { it.fits() } && widgets.indices.all { i ->
            (i + 1 until widgets.size).none { j -> widgets[i].intersects(widgets[j]) }
        }

/** Returns null for a blocked move: the caller must keep the last valid canvas. */
internal fun changeDeckWidget(widgets: List<DeckWidget>, changed: DeckWidget): List<DeckWidget>? {
    if (changed.id !in DECK_WIDGET_IDS) return null
    val result = widgets.map { if (it.id == changed.id) changed else it }
    if (validDeckWidgets(result)) return result
    val original = widgets.firstOrNull { it.id == changed.id } ?: return null
    // A full canvas still lets the user reorder equal-sized gauges with a single arrow press.
    if (original.visible && changed.visible && original.w == changed.w && original.h == changed.h &&
        (original.x != changed.x || original.y != changed.y)) {
        val blockedBy = widgets.filter { it.id != changed.id && changed.intersects(it) }
        if (blockedBy.size == 1) {
            val neighbour = blockedBy.single()
            if (neighbour.w == original.w && neighbour.h == original.h) {
                val swapped = widgets.map { widget -> when (widget.id) {
                    original.id -> original.copy(x = neighbour.x, y = neighbour.y)
                    neighbour.id -> neighbour.copy(x = original.x, y = original.y)
                    else -> widget
                } }
                if (validDeckWidgets(swapped)) return swapped
            }
        }
    }
    return null
}
