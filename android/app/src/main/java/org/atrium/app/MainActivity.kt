package org.atrium.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.atrium.app.data.Item
import org.atrium.app.editor.Downloads
import org.atrium.app.editor.EditorActivity
import org.atrium.app.ui.AccountScreen
import org.atrium.app.ui.AppViewModel
import org.atrium.app.ui.DriveHost
import org.atrium.app.ui.DriveScreen
import org.atrium.app.ui.Session
import org.atrium.app.ui.WelcomeScreen
import org.atrium.app.ui.theme.Atrium
import org.atrium.app.ui.theme.AtriumTheme

class MainActivity : ComponentActivity(), DriveHost {
    private val vm: AppViewModel by viewModels()
    private val showAccount = mutableStateOf(false)
    private var resumedOnce = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AtriumTheme {
                val session by vm.session.collectAsStateWithLifecycle()
                val drive by vm.drive.collectAsStateWithLifecycle()
                val auth by vm.auth.collectAsStateWithLifecycle()
                val message by vm.message.collectAsStateWithLifecycle()
                var account by showAccount
                when (val s = session) {
                    Session.Loading -> Box(Modifier.fillMaxSize().background(Atrium.colors.plane), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    Session.SignedOut -> {
                        account = false
                        WelcomeScreen(
                            auth = auth,
                            server = vm.baseUrl,
                            onGuest = vm::guest,
                            onLogin = { e, p -> vm.login(e, p) },
                            onSignup = { n, e, p -> vm.signup(n, e, p) },
                            onClearError = vm::clearAuthError,
                        )
                    }
                    is Session.SignedIn -> if (account) {
                        AccountScreen(
                            user = s.user,
                            usage = drive.usage,
                            server = vm.baseUrl,
                            onBack = { account = false },
                            onSignOut = { account = false; vm.logout() },
                            onOpenWeb = ::openUrl,
                        )
                    } else {
                        DriveScreen(vm, s.user, drive, message, this)
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Coming back from an editor: names, sizes and dates may have changed (or the user signed out there).
        if (resumedOnce) vm.checkSession()
        resumedOnce = true
    }

    override fun openUrl(url: String) {
        startActivity(EditorActivity.intent(this, url))
    }

    override fun shareLink(name: String, url: String) {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, name)
            .putExtra(Intent.EXTRA_TEXT, url)
        startActivity(Intent.createChooser(send, "Share “$name”"))
    }

    override fun download(item: Item) {
        Downloads.enqueue(this, vm.downloadUrl(item), "attachment; filename=\"${item.name}\"", item.mime)
    }

    override fun openAccount() {
        showAccount.value = true
    }

    override fun openPdfTool(tool: String, itemId: String?) {
        openUrl("${vm.baseUrl}/pdf/$tool" + if (itemId != null) "?item=${Uri.encode(itemId)}" else "")
    }
}
