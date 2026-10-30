package org.atrium.app.ui

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.atrium.app.AtriumApplication
import org.atrium.app.data.ApiException
import org.atrium.app.data.Item
import org.atrium.app.data.Kind
import org.atrium.app.data.SharedEntry
import org.atrium.app.data.Usage
import org.atrium.app.data.User
import java.io.IOException

sealed interface Session {
    data object Loading : Session
    data object SignedOut : Session
    data class SignedIn(val user: User) : Session
}

data class DriveState(
    val items: List<Item>? = null,
    val shared: List<SharedEntry> = emptyList(),
    val usage: Usage? = null,
    val refreshing: Boolean = false,
    val uploading: Int = 0,
    val error: String? = null,
)

data class AuthState(val busy: Boolean = false, val error: String? = null, val field: String? = null)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = (app as AtriumApplication).repository
    val baseUrl get() = repo.baseUrl

    private val _session = MutableStateFlow<Session>(Session.Loading)
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _drive = MutableStateFlow(DriveState())
    val drive: StateFlow<DriveState> = _drive.asStateFlow()

    private val _auth = MutableStateFlow(AuthState())
    val auth: StateFlow<AuthState> = _auth.asStateFlow()

    /** One-shot messages for the snackbar. */
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        checkSession()
    }

    fun checkSession() = viewModelScope.launch {
        try {
            val me = repo.me()
            if (me == null) {
                _session.value = Session.SignedOut
            } else {
                _session.value = Session.SignedIn(me.first)
                _drive.update { it.copy(usage = me.second ?: it.usage) }
                refresh()
            }
        } catch (e: IOException) {
            // Offline at launch: keep whatever the cookie says and let pull-to-refresh retry.
            _session.value = Session.SignedOut
            _auth.value = AuthState(error = "Can't reach ${repo.baseUrl.substringAfter("://")}. Check your connection.")
        }
    }

    fun clearAuthError() = _auth.update { it.copy(error = null, field = null) }

    fun guest() = signIn { repo.guest() }
    fun login(email: String, password: String) = signIn { repo.login(email.trim(), password) }
    fun signup(name: String, email: String, password: String) = signIn { repo.signup(name.trim(), email.trim(), password) }

    private fun signIn(block: suspend () -> User) = viewModelScope.launch {
        _auth.value = AuthState(busy = true)
        try {
            val user = block()
            _auth.value = AuthState()
            _drive.value = DriveState()
            _session.value = Session.SignedIn(user)
            refresh()
        } catch (e: ApiException) {
            _auth.value = AuthState(error = e.message, field = e.field)
        } catch (e: IOException) {
            _auth.value = AuthState(error = "Couldn't reach the server. Check your connection.")
        }
    }

    fun logout() = viewModelScope.launch {
        runCatching { repo.logout() }
        _drive.value = DriveState()
        _session.value = Session.SignedOut
    }

    fun refresh() = viewModelScope.launch {
        _drive.update { it.copy(refreshing = true) }
        try {
            val (items, usage) = repo.items()
            val shared = runCatching { repo.shared() }.getOrDefault(_drive.value.shared)
            _drive.update { it.copy(items = items, usage = usage ?: it.usage, shared = shared, refreshing = false, error = null) }
            repo.me()?.let { (user, _) -> _session.value = Session.SignedIn(user) }
        } catch (e: ApiException) {
            if (e.status == 401) {
                _session.value = Session.SignedOut
            }
            _drive.update { it.copy(refreshing = false, error = e.message) }
        } catch (e: IOException) {
            _drive.update { it.copy(refreshing = false, error = "Couldn't reach the server. Pull down to try again.") }
        }
    }

    fun consumeMessage() {
        _message.value = null
    }

    fun say(text: String) {
        _message.value = text
    }

    /** Runs a server call, folds a changed item back into the list and reports failures in the snackbar. */
    private fun act(done: String? = null, block: suspend () -> Item?) = viewModelScope.launch {
        try {
            block()?.let(::put)
            done?.let { _message.value = it }
        } catch (e: IOException) {
            _message.value = e.message ?: "Something went wrong."
        }
    }

    private fun put(item: Item) = _drive.update { s ->
        val list = s.items ?: return@update s
        val i = list.indexOfFirst { it.id == item.id }
        s.copy(items = if (i >= 0) list.toMutableList().also { it[i] = item } else list + item)
    }

    fun create(kind: Kind, name: String?, parentId: String?, opened: (Item) -> Unit) = viewModelScope.launch {
        try {
            val item = repo.create(kind, name, parentId)
            put(item)
            opened(item)
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun rename(item: Item, name: String) = act { repo.rename(item.id, name) }
    fun star(item: Item) = act(if (item.starred) "Removed from Starred" else "Added to Starred") { repo.star(item.id, !item.starred) }
    fun move(item: Item, parentId: String?) = act("Moved \"${item.name}\"") { repo.move(item.id, parentId) }
    fun copy(item: Item) = act("Made a copy of \"${item.name}\"") { repo.copy(item.id) }

    fun trash(item: Item) = viewModelScope.launch {
        try {
            repo.trash(item.id, true)
            _message.value = "Moved \"${item.name}\" to the trash"
            refresh() // a folder takes its contents with it
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun restore(item: Item) = viewModelScope.launch {
        try {
            repo.trash(item.id, false)
            _message.value = "Restored \"${item.name}\""
            refresh()
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun deleteForever(item: Item) = viewModelScope.launch {
        try {
            repo.deleteForever(item.id)
            _message.value = "Deleted \"${item.name}\" forever"
            refresh()
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun emptyTrash() = viewModelScope.launch {
        try {
            repo.emptyTrash()
            _message.value = "Trash emptied"
            refresh()
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun forgetShared(entry: SharedEntry) = viewModelScope.launch {
        try {
            repo.forgetShared(entry.shareId)
            _drive.update { s -> s.copy(shared = s.shared.filterNot { it.shareId == entry.shareId }) }
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    /** Makes sure the item has a public link, then hands the URL to [ready] (the share sheet). */
    fun shareLink(item: Item, ready: (String) -> Unit) = viewModelScope.launch {
        try {
            val shared = if (item.shareId != null) item else repo.share(item.id, true).also(::put)
            ready(repo.shareUrl(shared.shareId ?: return@launch))
        } catch (e: IOException) {
            _message.value = e.message
        }
    }

    fun stopSharing(item: Item) = act("Link turned off") { repo.share(item.id, false) }

    fun upload(uris: List<Uri>, parentId: String?) {
        val resolver = getApplication<Application>().contentResolver
        for (uri in uris) viewModelScope.launch {
            var name = "Upload"
            var length = -1L
            runCatching {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        c.getString(0)?.let { name = it }
                        if (!c.isNull(1)) length = c.getLong(1)
                    }
                }
            }
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            _drive.update { it.copy(uploading = it.uploading + 1) }
            try {
                val item = repo.upload(name, mime, parentId, length) {
                    resolver.openInputStream(uri) ?: throw IOException("Couldn't read $name.")
                }
                put(item)
                _message.value = "Uploaded \"${item.name}\""
            } catch (e: IOException) {
                _message.value = "$name: ${e.message}"
            } finally {
                _drive.update { it.copy(uploading = it.uploading - 1) }
            }
            refreshUsage()
        }
    }

    private suspend fun refreshUsage() {
        runCatching { repo.me() }.getOrNull()?.second?.let { u -> _drive.update { it.copy(usage = u) } }
    }

    fun openUrl(item: Item) = repo.openUrl(item)
    fun shareUrl(shareId: String) = repo.shareUrl(shareId)
    fun downloadUrl(item: Item) = repo.fileUrl(item.id, download = true)
}
