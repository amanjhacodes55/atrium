package org.atrium.app.editor

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.atrium.app.BuildConfig
import org.atrium.app.MainActivity
import org.atrium.app.R
import java.io.File

/**
 * Hosts the real web editors (Docs, Sheets, Slides, Notebook), public share links and file previews.
 *
 * Rewriting four editors natively would be a project of its own, so the app keeps its own chrome to a
 * minimum and bridges what a WebView can't do by itself: the shared session cookie, the image picker,
 * downloads, printing (the editors' "Download as PDF"), the back button, and handing navigation that
 * leaves the editor back to the native drive.
 */
class EditorActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorView: View
    private lateinit var downloads: Downloads
    private val host = BuildConfig.BASE_URL.toUri().host

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    /** Where the camera writes a photo taken from the file chooser, if one was offered. */
    private var cameraFile: File? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val picked = when {
            result.resultCode != RESULT_OK -> null
            data?.clipData != null -> Array(data.clipData!!.itemCount) { data.clipData!!.getItemAt(it).uri }
            data?.data != null -> arrayOf(data.data!!)
            // The camera returns no data; the photo is in the file we gave it.
            cameraFile?.let { it.length() > 0 } == true -> arrayOf(FileProvider.getUriForFile(this, "$packageName.files", cameraFile!!))
            else -> null
        }
        fileCallback?.onReceiveValue(picked)
        fileCallback = null
        cameraFile = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val start = intent.getStringExtra(EXTRA_URL) ?: intent.dataString ?: BuildConfig.BASE_URL
        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.loadWithOverviewMode = true
            setBackgroundColor(ContextCompat.getColor(context, R.color.plane))
            webViewClient = Client()
            webChromeClient = Chrome()
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        downloads = Downloads(this, webView)
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ -> downloads.download(url, contentDisposition, mimeType) }
        webView.addJavascriptInterface(PrintBridge(), "AtriumPrint")

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(context, R.color.accent))
        }
        errorView = buildErrorView()

        val root = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.plane))
            addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)).apply { gravity = Gravity.TOP })
            addView(errorView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)
        // Edge to edge: keep the page clear of the status bar, navigation bar and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else close()
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        if (webView.url == null) webView.loadUrl(start)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        webView.destroy()
        super.onDestroy()
    }

    /**
     * The file picker for an `<input type=file>`. WebView's own intent only uses the first accepted
     * type, so "PDF or image" would offer just PDFs; this one passes all of them, allows picking
     * several files, and offers the camera when the page takes images (to scan a page into a PDF).
     */
    private fun chooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val types = params.acceptTypes.orEmpty()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .mapNotNull { t -> if (t.startsWith(".")) MIME_BY_EXTENSION[t] ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(t.drop(1)) else t }
            .distinct()
        val content = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).apply {
            type = types.singleOrNull() ?: "*/*"
            if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        val chooser = Intent.createChooser(content, null)
        val takesImages = types.isEmpty() || types.any { it.startsWith("image/") }
        if (takesImages && packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val photo = File(dir, "scan-${System.currentTimeMillis()}.jpg")
            cameraFile = photo
            val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, FileProvider.getUriForFile(this, "$packageName.files", photo))
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        }
        return chooser
    }

    /** Back to the native drive; when we were opened from a link, the drive isn't underneath, so start it. */
    private fun close() {
        if (isTaskRoot) startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    /** Pages that are the web app's own drive/home screens; the native app replaces those. */
    private fun isHome(uri: Uri): Boolean {
        if (uri.host != host) return false
        val path = uri.path?.trimEnd('/').orEmpty()
        return path in HOME_PATHS
    }

    private fun buildErrorView(): View {
        val message = TextView(this).apply {
            text = getString(R.string.editor_offline)
            gravity = Gravity.CENTER
            textSize = 16f
            setTextColor(ContextCompat.getColor(context, R.color.ink))
        }
        val retry = Button(this).apply {
            text = getString(R.string.retry)
            setOnClickListener {
                errorView.visibility = View.GONE
                webView.reload()
            }
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(ContextCompat.getColor(context, R.color.plane))
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(message)
            addView(retry, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(16)
            })
            visibility = View.GONE
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == host && url.scheme in setOf("https", "http")) {
                if (isHome(url)) {
                    close()
                    return true
                }
                return false
            }
            // Anything else (help pages, links inside a document, mailto:) opens in its own app.
            try {
                startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(this@EditorActivity, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            }
            return true
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            // The web app routes client-side (history.pushState), which never reaches shouldOverrideUrlLoading.
            // Its "All files" button and "Move to trash" land on the drive pages: hand those back to the native drive.
            url?.toUri()?.let { if (isHome(it)) close() }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            progress.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            progress.visibility = View.GONE
            view.evaluateJavascript(Downloads.NAME_HOOK, null)
            // WebView ignores window.print(); route it to Android printing (which can save a PDF).
            view.evaluateJavascript("window.print = () => window.AtriumPrint && window.AtriumPrint.print(document.title);", null)
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) errorView.visibility = View.VISIBLE
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            // Shows the document's name in the recent-apps screen.
            if (!title.isNullOrBlank()) setTaskDescription(android.app.ActivityManager.TaskDescription.Builder().setLabel(title).build())
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                pickFiles.launch(chooserIntent(params))
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                Toast.makeText(this@EditorActivity, R.string.no_file_picker, Toast.LENGTH_SHORT).show()
                false
            }
        }
    }

    private inner class PrintBridge {
        @JavascriptInterface
        fun print(title: String?) {
            runOnUiThread {
                val name = title?.takeIf { it.isNotBlank() } ?: getString(R.string.app_name)
                val manager = getSystemService(PrintManager::class.java)
                manager.print(name, webView.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
            }
        }
    }

    companion object {
        private const val EXTRA_URL = "url"
        private val HOME_PATHS = setOf("", "/home", "/drive", "/docs", "/sheets", "/slides", "/notebook", "/pdf")
        private val MIME_BY_EXTENSION = mapOf(
            ".pdf" to "application/pdf",
            ".docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".csv" to "text/csv",
        )

        fun intent(context: Context, url: String): Intent = Intent(context, EditorActivity::class.java).putExtra(EXTRA_URL, url)
    }
}
