package org.atrium.app.data

import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** A failed call, carrying the server's own `{error}` message so screens can show it as is. */
class ApiException(val status: Int, message: String, val field: String? = null) : IOException(message)

/**
 * A tiny JSON client for the Atrium HTTP API (docs/api.md).
 *
 * The session cookie lives in [CookieManager], the WebView's own persistent cookie store, rather than a
 * separate jar: signing in natively therefore also signs in the editor WebView, and there is never a
 * second copy of the session to keep in sync.
 */
class ApiClient(private val baseUrl: String) {
    private val cookies: CookieManager get() = CookieManager.getInstance()

    suspend fun get(path: String): JSONObject = request("GET", path)
    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject = request("POST", path, body)
    suspend fun patch(path: String, body: JSONObject): JSONObject = request("PATCH", path, body)
    suspend fun delete(path: String, body: JSONObject? = null): JSONObject = request("DELETE", path, body)

    /** Sends raw bytes (not multipart), as `/api/upload` expects. */
    suspend fun postBytes(path: String, contentType: String, length: Long, open: () -> InputStream): JSONObject =
        request("POST", path, null) { conn ->
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", contentType)
            if (length >= 0) conn.setFixedLengthStreamingMode(length) else conn.setChunkedStreamingMode(64 * 1024)
            open().use { input -> conn.outputStream.use { input.copyTo(it, 64 * 1024) } }
        }

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        write: ((HttpURLConnection) -> Unit)? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val url = baseUrl + path
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            cookies.getCookie(url)?.let { setRequestProperty("Cookie", it) }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            body?.let { conn.outputStream.use { out -> out.write(it.toString().toByteArray()) } }
            write?.invoke(conn)
            val status = conn.responseCode
            conn.headerFields.entries
                .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
                .flatMap { it.value }
                .forEach { cookies.setCookie(url, it) }
            cookies.flush()
            val text = (if (status >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = text.takeIf { it.isNotBlank() }?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
            if (status >= 400) {
                val fallback = when (status) {
                    401 -> "Please sign in again."
                    413 -> "That is too large for this server."
                    else -> "Request failed ($status)."
                }
                throw ApiException(status, json.optString("error").ifBlank { fallback }, json.optString("field").ifBlank { null })
            }
            json
        } finally {
            conn.disconnect()
        }
    }

    /** Forgets the session locally even if the server could not be reached to sign out. */
    fun clearSession() {
        cookies.setCookie(baseUrl, "atrium_session=; Max-Age=0; Path=/")
        cookies.flush()
    }
}
