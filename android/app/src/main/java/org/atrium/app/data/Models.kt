package org.atrium.app.data

import org.json.JSONObject

enum class Kind(val wire: String, val editorPath: String?, val noun: String) {
    FOLDER("folder", null, "folder"),
    DOC("doc", "/docs", "document"),
    SHEET("sheet", "/sheets", "spreadsheet"),
    SLIDES("slides", "/slides", "presentation"),
    NOTEBOOK("notebook", "/notebook", "notebook"),
    FILE("file", null, "file");

    val editable get() = editorPath != null

    companion object {
        fun of(wire: String) = entries.firstOrNull { it.wire == wire } ?: FILE
    }
}

data class Item(
    val id: String,
    val kind: Kind,
    val name: String,
    val parentId: String?,
    val mime: String?,
    val size: Long,
    val starred: Boolean,
    val trashedAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
    val shareId: String?,
    val shareRole: String?,
) {
    val trashed get() = trashedAt != null
    val isPdf get() = kind == Kind.FILE && (mime == "application/pdf" || name.endsWith(".pdf", ignoreCase = true))

    companion object {
        fun from(o: JSONObject) = Item(
            id = o.getString("id"),
            kind = Kind.of(o.optString("kind")),
            name = o.optString("name"),
            parentId = o.optStringOrNull("parentId"),
            mime = o.optStringOrNull("mime"),
            size = o.optLong("size"),
            starred = o.optBoolean("starred"),
            trashedAt = if (o.isNull("trashedAt")) null else o.optLong("trashedAt"),
            createdAt = o.optLong("createdAt"),
            updatedAt = o.optLong("updatedAt"),
            shareId = o.optStringOrNull("shareId"),
            shareRole = o.optStringOrNull("shareRole"),
        )
    }
}

data class User(val id: String, val email: String, val name: String, val guest: Boolean) {
    companion object {
        fun from(o: JSONObject) = User(o.optString("id"), o.optString("email"), o.optString("name"), o.optBoolean("guest"))
    }
}

data class Usage(val used: Long, val quota: Long) {
    val fraction get() = if (quota > 0) (used.toFloat() / quota).coerceIn(0f, 1f) else 0f

    companion object {
        fun from(o: JSONObject?) = o?.let { Usage(it.optLong("used"), it.optLong("quota")) }
    }
}

/** A link someone else shared that this user has opened ("Shared with me"). */
data class SharedEntry(val shareId: String, val name: String, val kind: Kind, val role: String, val owner: String, val openedAt: Long) {
    companion object {
        fun from(o: JSONObject) = SharedEntry(
            o.optString("shareId"), o.optString("name"), Kind.of(o.optString("kind")),
            o.optString("role", "view"), o.optString("owner"), o.optLong("openedAt"),
        )
    }
}

internal fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else optString(key).ifEmpty { null }
