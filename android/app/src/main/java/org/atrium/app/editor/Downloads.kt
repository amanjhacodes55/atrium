package org.atrium.app.editor

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.core.net.toUri
import java.io.File
import java.io.OutputStream

/**
 * Saves what the editors offer for download.
 *
 * Server files (`/api/items/:id/file`) go to [DownloadManager] with the session cookie. Exports the
 * editors build in the page (.docx, .xlsx, .pptx, …) arrive as `blob:` URLs that only the page can
 * read, so for those the page streams the blob back to us in base64 chunks, which we write into
 * Downloads. `data:` URLs are decoded directly.
 */
@SuppressLint("JavascriptInterface")
class Downloads(private val activity: Activity, private val webView: WebView) {
    private var out: OutputStream? = null
    private var target: String? = null
    private var finish: ((Boolean) -> Unit)? = null

    init {
        webView.addJavascriptInterface(this, BRIDGE)
    }

    fun download(url: String, contentDisposition: String?, mimeType: String?) {
        when {
            url.startsWith("blob:") -> fetchBlob(url, mimeType)
            url.startsWith("data:") -> saveDataUrl(url, mimeType)
            url.startsWith("http") -> enqueue(activity, url, contentDisposition, mimeType)
            else -> toast(activity, "This file can't be downloaded on Android.")
        }
    }

    private fun fetchBlob(url: String, mimeType: String?) {
        if (out != null) {
            toast(activity, "A download is already in progress.")
            return
        }
        // The page records the <a download="…"> name for each blob URL (see NAME_HOOK).
        val js = """
            (async () => {
              const b = window.$BRIDGE;
              try {
                const blob = await (await fetch(${quote(url)})).blob();
                const name = (window.__atriumNames || {})[${quote(url)}] || "";
                if (!b.begin(name, blob.type || ${quote(mimeType ?: "")})) return;
                const size = 768 * 1024;
                for (let i = 0; i < blob.size; i += size) {
                  const bytes = new Uint8Array(await blob.slice(i, i + size).arrayBuffer());
                  let s = "";
                  for (let j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
                  b.chunk(btoa(s));
                }
                b.done(true);
              } catch (e) { b.done(false); }
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun saveDataUrl(url: String, mimeType: String?) {
        val comma = url.indexOf(',')
        if (comma < 0) return
        val meta = url.substring(5, comma)
        val mime = meta.substringBefore(';').ifBlank { mimeType ?: "application/octet-stream" }
        val bytes = runCatching {
            if (meta.endsWith(";base64")) Base64.decode(url.substring(comma + 1), Base64.DEFAULT)
            else android.net.Uri.decode(url.substring(comma + 1)).toByteArray()
        }.getOrNull() ?: return toast(activity, "Couldn't save the file.")
        if (!begin("", mime)) return
        runCatching { out?.write(bytes) }
        done(true)
    }

    /** Opens a stream into the public Downloads folder; via MediaStore where scoped storage requires it. */
    @JavascriptInterface
    fun begin(name: String, mime: String): Boolean {
        val type = mime.ifBlank { "application/octet-stream" }
        val file = sanitize(name.ifBlank { URLUtil.guessFileName(null, null, type) })
        val ok = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, file)
                    put(MediaStore.Downloads.MIME_TYPE, type)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
                out = resolver.openOutputStream(uri)
                finish = { ok ->
                    // A failed copy shouldn't leave a broken half-file in Downloads.
                    if (ok) resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                    else resolver.delete(uri, null, null)
                }
            } else {
                // Before Android 10 public Downloads needs a storage permission; the app's own folder doesn't.
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return@runCatching false
                val f = File(dir, file)
                out = f.outputStream()
                finish = { ok -> if (!ok) f.delete() }
            }
            target = file
            out != null
        }.getOrDefault(false)
        if (!ok) toast(activity, "Couldn't save the file.")
        return ok
    }

    @JavascriptInterface
    fun chunk(base64: String) {
        runCatching { out?.write(Base64.decode(base64, Base64.DEFAULT)) }
    }

    @JavascriptInterface
    fun done(ok: Boolean) {
        runCatching { out?.close() }
        runCatching { finish?.invoke(ok) }
        val name = target
        out = null
        finish = null
        target = null
        toast(activity, if (ok && name != null) "Saved $name to Downloads" else "Couldn't save the file.")
    }

    companion object {
        private const val BRIDGE = "AtriumDownloads"

        /** Remembers the file name of every `<a download>` the page clicks, keyed by its blob/data URL. */
        const val NAME_HOOK = """
            (() => {
              if (window.__atriumNames) return;
              window.__atriumNames = {};
              const remember = (a) => { if (a && a.download && a.href) window.__atriumNames[a.href] = a.download; };
              const click = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function () { remember(this); return click.apply(this, arguments); };
              document.addEventListener("click", (e) => remember(e.target && e.target.closest && e.target.closest("a[download]")), true);
            })();
        """

        fun enqueue(activity: Activity, url: String, contentDisposition: String?, mimeType: String?) {
            val name = sanitize(URLUtil.guessFileName(url, contentDisposition, mimeType))
            runCatching {
                val request = DownloadManager.Request(url.toUri())
                    .setMimeType(mimeType)
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                activity.getSystemService(DownloadManager::class.java).enqueue(request)
            }.onSuccess { toast(activity, "Downloading $name") }
                .onFailure { toast(activity, "Couldn't start the download.") }
        }

        private fun sanitize(name: String) = name.replace(Regex("[\\\\/:*?\"<>|]+"), "_").trim().ifEmpty { "download" }

        private fun toast(activity: Activity, text: String) = activity.runOnUiThread {
            Toast.makeText(activity, text, Toast.LENGTH_LONG).show()
        }

        private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    }
}
