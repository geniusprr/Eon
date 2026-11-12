package com.kapanis.mobil.eon2.protocol

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale

/** Canonical JSON v1: UTF-16 key sort, exact UTF-8 strings and safe integer numbers. */
object CanonicalNotes {
    private val revisionFields = setOf("version", "noteId", "parents", "deleted", "body", "metadata", "id")
    private val operationFields = setOf("version", "vaultId", "deviceId", "sequence", "revision", "id")
    private val hashPattern = Regex("^[a-f0-9]{64}$")

    private fun hasExactKeys(obj: JSONObject, fields: Set<String>): Boolean =
        obj.keys().asSequence().toSet() == fields

    private fun identifier(value: Any?): Boolean = value is String && value.length in 1..256

    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }

    fun hashJson(value: Any): String = sha256(json(value))

    /** The same case-folded NFC path key used by the TypeScript journal projection. */
    fun pathKey(value: String): String = Normalizer.normalize(value.replace('\\', '/'), Normalizer.Form.NFC).lowercase(Locale.ROOT)

    fun isSafeRelativeNotePath(value: String): Boolean {
        if (value.isEmpty() || value.length > 240 || !value.lowercase(Locale.ROOT).endsWith(".md")) return false
        if (value.startsWith('/') || value.startsWith('\\') || value.any { it.code < 0x20 || it in "<>:\"|?*" }) return false
        val segments = value.replace('\\', '/').split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." || it.endsWith(' ') || it.endsWith('.') }) return false
        if (segments.any { it.matches(Regex("(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$")) }) return false
        return true
    }

    fun json(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is Boolean -> if (value) "true" else "false"
        is String -> quote(value)
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
            quote(key) + ":" + json(value.get(key))
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { json(value.get(it)) }
        is Int, is Long -> {
            val number = (value as Number).toLong()
            require(number in -9007199254740991L..9007199254740991L) { "Unsafe JSON integer" }
            number.toString()
        }
        else -> error("Unsupported canonical JSON type: ${value::class.java.simpleName}")
    }

    private fun quote(text: String): String {
        val builder = StringBuilder(text.length + 2)
        builder.append('"')
        var index = 0
        while (index < text.length) {
            val c = text[index]
            when (c) {
                '"' -> builder.append("\\\"")
                '\\' -> builder.append("\\\\")
                '\b' -> builder.append("\\b")
                '\u000c' -> builder.append("\\f")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                else -> {
                    if (c.code < 0x20) builder.append("\\u%04x".format(Locale.ROOT, c.code))
                    else if (Character.isHighSurrogate(c)) {
                        require(index + 1 < text.length && Character.isLowSurrogate(text[index + 1])) { "Invalid high surrogate" }
                        builder.append(c).append(text[++index])
                    } else {
                        require(!Character.isLowSurrogate(c)) { "Invalid low surrogate" }
                        builder.append(c)
                    }
                }
            }
            index++
        }
        return builder.append('"').toString()
    }

    fun revision(noteId: String, parents: List<String>, deleted: Boolean, body: String?, metadata: JSONObject?): JSONObject {
        require(identifier(noteId)) { "Invalid note ID" }
        json(noteId)
        require(parents.distinct().size == parents.size)
        val base = JSONObject()
            .put("version", 1)
            .put("noteId", noteId)
            .put("parents", JSONArray(parents.sorted()))
            .put("deleted", deleted)
            .put("body", if (deleted) JSONObject.NULL else body ?: error("Missing body"))
            .put("metadata", if (deleted) JSONObject.NULL else metadata ?: error("Missing metadata"))
        return base.put("id", hashJson(base))
    }

    fun operation(vaultId: String, deviceId: String, sequence: Long, revision: JSONObject): JSONObject {
        require(sequence in 1..9007199254740991L)
        val base = JSONObject()
            .put("version", 1)
            .put("vaultId", vaultId)
            .put("deviceId", deviceId)
            .put("sequence", sequence)
            .put("revision", revision)
        return base.put("id", hashJson(base))
    }

    fun verifyRevision(revision: JSONObject) {
        require(hasExactKeys(revision, revisionFields)) { "Revision fields mismatch" }
        require(revision.get("version") is Number && revision.getInt("version") == 1) { "Unsupported revision version" }
        require(identifier(revision.get("noteId"))) { "Invalid note ID" }
        require(revision.get("id") is String && hashPattern.matches(revision.getString("id"))) { "Invalid revision ID" }
        require(revision.get("deleted") is Boolean) { "Invalid tombstone flag" }
        val copy = JSONObject(revision.toString()).apply { remove("id") }
        require(revision.getString("id") == hashJson(copy)) { "Revision hash mismatch" }
        val parents = revision.getJSONArray("parents")
        val values = (0 until parents.length()).map { parents.getString(it) }
        require(values.sorted().distinct() == values && values.all { hashPattern.matches(it) } && revision.getString("id") !in values) { "Invalid ancestry" }
        if (revision.getBoolean("deleted")) {
            require(revision.isNull("body") && revision.isNull("metadata")) { "Tombstone must contain no live content" }
        } else {
            require(revision.get("body") is String && revision.get("metadata") is JSONObject) { "Invalid live revision content" }
            // Reject foreign JSON values Android cannot roundtrip with TS canonical JSON.
            json(revision.getJSONObject("metadata"))
        }
    }

    fun verifyOperation(operation: JSONObject, vaultId: String) {
        require(hasExactKeys(operation, operationFields)) { "Operation fields mismatch" }
        require(operation.get("version") is Number && operation.getInt("version") == 1) { "Unsupported operation version" }
        require(identifier(operation.get("vaultId")) && identifier(operation.get("deviceId"))) { "Invalid operation identity" }
        require(operation.get("id") is String && hashPattern.matches(operation.getString("id"))) { "Invalid operation hash" }
        require(operation.get("sequence") is Number && operation.getLong("sequence") in 1..9007199254740991L) { "Invalid device sequence" }
        val copy = JSONObject(operation.toString()).apply { remove("id") }
        require(operation.getString("vaultId") == vaultId) { "Wrong vault" }
        require(operation.getString("id") == hashJson(copy)) { "Operation hash mismatch" }
        verifyRevision(operation.getJSONObject("revision"))
    }
}
