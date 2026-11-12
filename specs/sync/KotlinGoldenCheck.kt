import com.kapanis.mobil.eon2.protocol.CanonicalNotes
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** JVM-only golden runner; compiles the production Android CanonicalNotes.kt source. */
fun main(args: Array<String>) {
    require(args.size == 1) { "Provide specs/sync/golden-v1.json" }
    val golden = JSONObject(File(args[0]).readText(Charsets.UTF_8))
    val canonicalInput = JSONObject().put("z", 1).put("a", JSONArray(listOf("é", "x\n")))
    check(CanonicalNotes.json(canonicalInput) == golden.getString("canonical"))
    check(CanonicalNotes.hashJson(canonicalInput) == golden.getString("canonicalSha256"))

    val originalRevision = golden.getJSONObject("revision")
    val noteId = originalRevision.getString("noteId")
    val revision = CanonicalNotes.revision(
        noteId,
        emptyList(),
        false,
        originalRevision.getString("body"),
        originalRevision.getJSONObject("metadata"),
    )
    check(revision.getString("id") == originalRevision.getString("id"))
    CanonicalNotes.verifyRevision(originalRevision)

    val originalOperation = golden.getJSONObject("operation")
    val operation = CanonicalNotes.operation(
        originalOperation.getString("vaultId"),
        originalOperation.getString("deviceId"),
        originalOperation.getLong("sequence"),
        revision,
    )
    check(operation.getString("id") == originalOperation.getString("id"))
    CanonicalNotes.verifyOperation(originalOperation, "vault-01")

    // Additional cases guard against accepting hash-valid but structurally invalid revisions.
    val invalidTombstone = JSONObject(originalRevision.toString())
        .put("deleted", true)
        .put("body", "Should be null")
        .put("metadata", JSONObject.NULL)
    invalidTombstone.put("id", CanonicalNotes.hashJson(JSONObject(invalidTombstone.toString()).apply { remove("id") }))
    check(runCatching { CanonicalNotes.verifyRevision(invalidTombstone) }.isFailure)
    val withExtraField = JSONObject(originalRevision.toString()).put("unused", true)
    withExtraField.put("id", CanonicalNotes.hashJson(JSONObject(withExtraField.toString()).apply { remove("id") }))
    check(runCatching { CanonicalNotes.verifyRevision(withExtraField) }.isFailure)
    check(CanonicalNotes.pathKey("Docs\\İş.md") == CanonicalNotes.pathKey("docs/i\u0307ş.md"))
    check(!CanonicalNotes.isSafeRelativeNotePath("../outside.md"))
    check(!CanonicalNotes.isSafeRelativeNotePath("CON.md"))
    check(CanonicalNotes.isSafeRelativeNotePath("Notes/Other.md"))

    println("Eon 2.0 Kotlin/TypeScript canonical/revision/operation golden hashes MATCH")
}
