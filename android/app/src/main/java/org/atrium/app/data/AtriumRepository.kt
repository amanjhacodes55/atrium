package org.atrium.app.data

import android.net.Uri
import org.json.JSONObject
import java.io.InputStream

/** Every server call the app makes, in the shapes the screens want. */
class AtriumRepository(private val api: ApiClient, val baseUrl: String) {

    /** The signed-in user and their storage use, or null when there is no (valid) session. */
    suspend fun me(): Pair<User, Usage?>? = try {
        val r = api.get("/api/auth/me")
        User.from(r.getJSONObject("user")) to Usage.from(r.optJSONObject("usage"))
    } catch (e: ApiException) {
        if (e.status == 401) null else throw e
    }

    suspend fun login(email: String, password: String): User =
        User.from(api.post("/api/auth/login", JSONObject().put("email", email).put("password", password)).getJSONObject("user"))

    suspend fun signup(name: String, email: String, password: String): User =
        User.from(
            api.post("/api/auth/signup", JSONObject().put("name", name).put("email", email).put("password", password))
                .getJSONObject("user"),
        )

    suspend fun guest(): User = User.from(api.post("/api/auth/guest").getJSONObject("user"))

    suspend fun logout() {
        try {
            api.post("/api/auth/logout")
        } finally {
            api.clearSession()
        }
    }

    suspend fun items(): Pair<List<Item>, Usage?> {
        val r = api.get("/api/items")
        val arr = r.getJSONArray("items")
        return List(arr.length()) { Item.from(arr.getJSONObject(it)) } to Usage.from(r.optJSONObject("usage"))
    }

    suspend fun shared(): List<SharedEntry> {
        val arr = api.get("/api/shared").optJSONArray("shared") ?: return emptyList()
        return List(arr.length()) { SharedEntry.from(arr.getJSONObject(it)) }
    }

    suspend fun forgetShared(shareId: String) {
        api.delete("/api/shared", JSONObject().put("shareId", shareId))
    }

    suspend fun create(kind: Kind, name: String?, parentId: String?): Item {
        val body = JSONObject().put("kind", kind.wire).put("parentId", parentId ?: JSONObject.NULL)
        if (!name.isNullOrBlank()) body.put("name", name.trim())
        return Item.from(api.post("/api/items", body).getJSONObject("item"))
    }

    suspend fun update(id: String, changes: JSONObject): Item =
        Item.from(api.patch("/api/items/${enc(id)}", changes).getJSONObject("item"))

    suspend fun rename(id: String, name: String) = update(id, JSONObject().put("name", name.trim()))
    suspend fun star(id: String, starred: Boolean) = update(id, JSONObject().put("starred", starred))
    suspend fun move(id: String, parentId: String?) = update(id, JSONObject().put("parentId", parentId ?: JSONObject.NULL))
    suspend fun trash(id: String, trashed: Boolean) = update(id, JSONObject().put("trashed", trashed))

    suspend fun copy(id: String): Item = Item.from(api.post("/api/items/${enc(id)}/copy").getJSONObject("item"))

    suspend fun deleteForever(id: String) {
        api.delete("/api/items/${enc(id)}")
    }

    suspend fun emptyTrash() {
        api.delete("/api/trash")
    }

    /** Turns the public link on (keeping an existing one) or off. */
    suspend fun share(id: String, on: Boolean): Item {
        val body = JSONObject().put("on", on)
        if (on) body.put("role", "view")
        return Item.from(api.post("/api/items/${enc(id)}/share", body).getJSONObject("item"))
    }

    suspend fun upload(name: String, mime: String, parentId: String?, length: Long, open: () -> InputStream): Item {
        val q = Uri.Builder().appendQueryParameter("name", name).appendQueryParameter("type", mime)
        if (parentId != null) q.appendQueryParameter("parent", parentId)
        return Item.from(api.postBytes("/api/upload" + q.build().toString(), mime, length, open).getJSONObject("item"))
    }

    fun shareUrl(shareId: String) = "$baseUrl/s/$shareId"
    fun fileUrl(id: String, download: Boolean = false) = "$baseUrl/api/items/${enc(id)}/file" + if (download) "?download" else ""

    /** Where the web app opens an item: the editor for documents, the file itself for uploads. */
    fun openUrl(item: Item): String? = when {
        item.kind.editable -> "$baseUrl${item.kind.editorPath}/${enc(item.id)}"
        item.kind == Kind.FILE -> fileUrl(item.id)
        else -> null
    }

    private fun enc(s: String) = Uri.encode(s)
}
