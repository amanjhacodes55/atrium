package org.atrium.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.atrium.app.R
import org.atrium.app.data.Item
import org.atrium.app.data.Kind
import org.atrium.app.data.SharedEntry
import org.atrium.app.data.User
import org.atrium.app.ui.theme.Atrium

enum class Tab(val label: String, val icon: Int) {
    RECENT("Recent", R.drawable.ic_schedule),
    STARRED("Starred", R.drawable.ic_star),
    MY_DRIVE("My Drive", R.drawable.ic_drive),
    SHARED("Shared", R.drawable.ic_people),
    TRASH("Trash", R.drawable.ic_delete),
}

/** What the drive needs from the Activity: things that start other screens or apps. */
interface DriveHost {
    fun openUrl(url: String)
    fun shareLink(name: String, url: String)
    fun download(item: Item)
    fun openAccount()
    /** Opens a PDF tool (`merge`, `edit`, …), started on a PDF from the drive when [itemId] is given. */
    fun openPdfTool(tool: String, itemId: String? = null)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveScreen(vm: AppViewModel, user: User, state: DriveState, message: String?, host: DriveHost) {
    var tab by rememberSaveable { mutableStateOf(Tab.MY_DRIVE) }
    var folderId by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    /** An app from the Apps row (Docs, Sheets, …): the drive shows just its files. */
    var app by rememberSaveable { mutableStateOf<AtriumApp?>(null) }
    var actionsFor by remember { mutableStateOf<Item?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }

    val items = state.items.orEmpty()
    val byId = remember(items) { items.associateBy { it.id } }
    // A folder that was trashed or deleted elsewhere drops us back to the top.
    if (folderId != null && state.items != null && byId[folderId]?.trashed != false) folderId = null

    LaunchedEffect(message) {
        if (message != null) {
            vm.consumeMessage()
            snackbar.showSnackbar(message)
        }
    }

    BackHandler(enabled = query.isNotEmpty() || app != null || (tab == Tab.MY_DRIVE && folderId != null) || tab != Tab.MY_DRIVE) {
        when {
            query.isNotEmpty() -> query = ""
            app != null -> app = null
            tab == Tab.MY_DRIVE && folderId != null -> folderId = byId[folderId]?.parentId
            else -> tab = Tab.MY_DRIVE
        }
    }

    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.upload(uris, if (tab == Tab.MY_DRIVE) folderId else null)
    }

    val open: (Item) -> Unit = { item ->
        if (item.kind == Kind.FOLDER) {
            if (!item.trashed) {
                query = ""
                tab = Tab.MY_DRIVE
                folderId = item.id
            }
        } else if (item.isPdf) {
            // WebView can't show PDFs, so they open in the PDF editor, which shows every page.
            host.openPdfTool(PdfTool.EDIT.path, item.id)
        } else {
            vm.openUrl(item)?.let(host::openUrl)
        }
    }

    Scaffold(
        containerColor = Atrium.colors.plane,
        topBar = { SearchBar(query, onQuery = { query = it }, user = user, onAccount = host::openAccount) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (tab != Tab.TRASH) {
                FloatingActionButton(
                    onClick = {
                        // In an app, + makes one of its files straight away; PDF starts the Create tool.
                        val kind = app?.kind
                        when {
                            app == AtriumApp.PDF -> host.openPdfTool(PdfTool.CREATE.path)
                            kind != null -> vm.create(kind, null, null) { open(it) }
                            else -> showCreate = true
                        }
                    },
                    containerColor = Atrium.colors.accent,
                    contentColor = Color.White,
                ) { Icon(painterResource(R.drawable.ic_add), contentDescription = "New") }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Atrium.colors.surface, tonalElevation = 0.dp) {
                for (t in Tab.entries) {
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = {
                            if (tab == t && t == Tab.MY_DRIVE) folderId = null
                            app = null
                            tab = t
                            query = ""
                        },
                        icon = { Icon(painterResource(t.icon), contentDescription = null) },
                        label = { Text(t.label, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Atrium.colors.accentInk,
                            selectedTextColor = Atrium.colors.accentInk,
                            indicatorColor = Atrium.colors.accentWash,
                            unselectedIconColor = Atrium.colors.ink2,
                            unselectedTextColor = Atrium.colors.ink2,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { vm.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            val q = query.trim().lowercase()
            val live = items.filter { !it.trashed }
            val shown: List<Item> = when {
                q.isNotEmpty() -> sortItems(live.filter { it.name.lowercase().contains(q) && app?.holds(it) != false })
                app != null -> live.filter { app!!.holds(it) }.sortedByDescending { it.updatedAt }
                tab == Tab.RECENT -> live.filter { it.kind != Kind.FOLDER }.sortedByDescending { it.updatedAt }.take(50)
                tab == Tab.STARRED -> sortItems(live.filter { it.starred })
                tab == Tab.SHARED -> sortItems(live.filter { it.shareId != null })
                // Show what was trashed, not everything that went with a trashed folder.
                tab == Tab.TRASH -> items.filter { it.trashed && !(it.parentId != null && byId[it.parentId]?.trashedAt == it.trashedAt) }
                    .sortedByDescending { it.trashedAt }
                else -> sortItems(live.filter { it.parentId == folderId })
            }

            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                if (q.isEmpty() && app == null && (tab == Tab.RECENT || (tab == Tab.MY_DRIVE && folderId == null))) {
                    item(key = "apps") {
                        AppsStrip {
                            app = it
                            folderId = null
                        }
                    }
                }
                if (q.isEmpty() && (app == AtriumApp.PDF || (app == null && (tab == Tab.RECENT || (tab == Tab.MY_DRIVE && folderId == null))))) {
                    item(key = "pdf-tools") { PdfToolsStrip { host.openPdfTool(it.path) } }
                }
                item(key = "header") {
                    Header(
                        title = when {
                            q.isNotEmpty() -> "Results for “${query.trim()}”"
                            app != null -> app!!.label
                            tab == Tab.SHARED -> "Shared"
                            else -> tab.label
                        },
                        trail = if (tab == Tab.MY_DRIVE && q.isEmpty() && app == null) trail(folderId, byId) else emptyList(),
                        onBack = app?.let { { app = null } },
                        onCrumb = { folderId = it },
                        action = if (tab == Tab.TRASH && q.isEmpty() && shown.isNotEmpty()) ("Empty trash" to { vm.emptyTrash() }) else null,
                        uploading = state.uploading,
                    )
                }
                state.error?.let { err -> item(key = "error") { Notice(err) } }

                if (tab == Tab.SHARED && q.isEmpty()) {
                    item(key = "with-me-h") { SectionLabel("Shared with me") }
                    if (state.shared.isEmpty()) item(key = "with-me-empty") { Hint("Links other people share with you appear here after you open them.") }
                    items(state.shared, key = { "w-" + it.shareId }) { e ->
                        SharedRow(e, onOpen = { host.openUrl(vm.shareUrl(e.shareId)) }, onForget = { vm.forgetShared(e) })
                    }
                    item(key = "by-me-h") { SectionLabel("Shared by me") }
                }

                if (state.items == null && state.error == null) {
                    item(key = "loading") { Hint("Loading…") }
                } else if (shown.isEmpty() && !(tab == Tab.SHARED && q.isEmpty() && state.shared.isNotEmpty())) {
                    item(key = "empty") { Hint(app?.takeIf { q.isEmpty() }?.empty ?: emptyText(tab, q.isNotEmpty(), folderId != null)) }
                }
                items(shown, key = { it.id }) { item ->
                    ItemRow(
                        item = item,
                        location = if (q.isNotEmpty() || app != null || tab != Tab.MY_DRIVE) item.parentId?.let { byId[it]?.name } else null,
                        onOpen = { if (item.trashed) actionsFor = item else open(item) },
                        onMore = { actionsFor = item },
                    )
                }
                if (tab == Tab.MY_DRIVE && folderId == null && q.isEmpty() && app == null) {
                    state.usage?.let { u -> item(key = "usage") { StorageCard(u.used, u.quota, u.fraction) } }
                }
            }
        }
    }

    actionsFor?.let { item ->
        // Keep the sheet showing the freshest copy (star toggles, renames).
        val current = byId[item.id] ?: item
        ItemActionsSheet(
            item = current,
            folders = items.filter { it.kind == Kind.FOLDER && !it.trashed },
            vm = vm,
            host = host,
            onOpen = { open(current) },
            onDismiss = { actionsFor = null },
        )
    }

    if (showCreate) {
        CreateSheet(
            onDismiss = { showCreate = false },
            onCreate = { kind, name ->
                showCreate = false
                val parent = if (tab == Tab.MY_DRIVE) folderId else null
                vm.create(kind, name, parent) { created -> if (kind != Kind.FOLDER) open(created) }
            },
            onUpload = {
                showCreate = false
                upload.launch(arrayOf("*/*"))
            },
        )
    }
}

private fun sortItems(list: List<Item>) = list.sortedWith(
    compareBy<Item> { it.kind != Kind.FOLDER }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name },
)

private fun trail(folderId: String?, byId: Map<String, Item>): List<Item> {
    val out = ArrayList<Item>()
    var id = folderId
    while (id != null) {
        val f = byId[id] ?: break
        out.add(0, f)
        id = f.parentId
        if (out.size > 50) break
    }
    return out
}

private fun emptyText(tab: Tab, searching: Boolean, inFolder: Boolean) = when {
    searching -> "Nothing in your drive matches that."
    tab == Tab.RECENT -> "Files you create or edit show up here."
    tab == Tab.STARRED -> "Star files to find them quickly."
    tab == Tab.SHARED -> "Nothing shared yet. Use Share link on a file to make one."
    tab == Tab.TRASH -> "The trash is empty."
    inFolder -> "This folder is empty. Tap + to add something."
    else -> "Your drive is empty. Tap + to create a document or upload a file."
}

@Composable
private fun SearchBar(query: String, onQuery: (String) -> Unit, user: User, onAccount: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Atrium.colors.plane)
            .statusBarsPadding()
            .padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = query,
            onValueChange = onQuery,
            placeholder = { Text("Search in Drive") },
            singleLine = true,
            leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null, tint = Atrium.colors.muted) },
            trailingIcon = if (query.isNotEmpty()) ({
                IconButton(onClick = { onQuery("") }) { Icon(painterResource(R.drawable.ic_close), contentDescription = "Clear search") }
            }) else null,
            shape = RoundedCornerShape(28.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Atrium.colors.surface2,
                unfocusedContainerColor = Atrium.colors.surface2,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier
                .weight(1f)
                .height(52.dp),
        )
        Spacer(Modifier.width(8.dp))
        Avatar(user.name, onClick = onAccount)
    }
}

@Composable
fun Avatar(name: String, size: Int = 40, onClick: (() -> Unit)? = null) {
    val initial = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Atrium.colors.accent)
            .then(if (onClick != null) Modifier.clickable(onClickLabel = "Account", onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, color = Color.White, fontWeight = FontWeight.SemiBold, style = if (size > 48) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun Header(title: String, trail: List<Item>, onCrumb: (String?) -> Unit, action: Pair<String, () -> Unit>?, uploading: Int, onBack: (() -> Unit)? = null) {
    Column(Modifier.padding(start = if (onBack != null) 4.dp else 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            onBack?.let {
                IconButton(onClick = it) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back to the drive", tint = Atrium.colors.ink) }
            }
            if (trail.isEmpty()) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = Atrium.colors.ink, modifier = Modifier.weight(1f))
            } else {
                Row(
                    Modifier
                        .weight(1f)
                        .horizontalScroll(rememberScrollState()),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Crumb("My Drive", current = false) { onCrumb(null) }
                    trail.forEachIndexed { i, f ->
                        Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = Atrium.colors.muted, modifier = Modifier.size(20.dp))
                        Crumb(f.name, current = i == trail.lastIndex) { onCrumb(f.id) }
                    }
                }
            }
            action?.let { (label, run) -> TextButton(onClick = run) { Text(label, color = Atrium.colors.danger) } }
        }
        if (uploading > 0) {
            Spacer(Modifier.height(6.dp))
            Text("Uploading $uploading file${if (uploading == 1) "" else "s"}…", style = MaterialTheme.typography.bodySmall, color = Atrium.colors.ink2)
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(Modifier.fillMaxWidth().padding(end = 8.dp))
        }
    }
}

@Composable
private fun Crumb(text: String, current: Boolean, onClick: () -> Unit) {
    Text(
        text,
        style = if (current) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
        color = if (current) Atrium.colors.ink else Atrium.colors.ink2,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 4.dp),
    )
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = Atrium.colors.muted,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Atrium.colors.muted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 24.dp))
}

@Composable
private fun Notice(text: String) {
    Surface(color = Atrium.colors.danger.copy(alpha = 0.1f), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Text(text, color = Atrium.colors.danger, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ItemRow(item: Item, location: String?, onOpen: () -> Unit, onMore: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onOpen, onLongClick = onMore, onLongClickLabel = "More actions")
            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ItemTile(item)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    color = Atrium.colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (item.starred) {
                    Spacer(Modifier.width(4.dp))
                    Icon(painterResource(R.drawable.ic_star), contentDescription = "Starred", tint = Atrium.colors.drive, modifier = Modifier.size(16.dp))
                }
                if (item.shareId != null) {
                    Spacer(Modifier.width(4.dp))
                    Icon(painterResource(R.drawable.ic_link), contentDescription = "Shared by link", tint = Atrium.colors.muted, modifier = Modifier.size(16.dp))
                }
            }
            Text(
                subtitle(item, location),
                style = MaterialTheme.typography.bodySmall,
                color = Atrium.colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onMore) { Icon(painterResource(R.drawable.ic_more_vert), contentDescription = "More actions for ${item.name}", tint = Atrium.colors.ink2) }
    }
}

private fun subtitle(item: Item, location: String?): String = buildList {
    if (item.trashedAt != null) add("Trashed ${formatWhen(item.trashedAt)}") else add(formatWhen(item.updatedAt))
    if (item.kind != Kind.FOLDER) add(formatBytes(item.size))
    location?.let { add("in $it") }
}.joinToString(" · ")

@Composable
private fun SharedRow(e: SharedEntry, onOpen: () -> Unit, onForget: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindTile(e.kind)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(e.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Atrium.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${e.owner} · ${if (e.role == "edit") "Can edit" else "View only"} · ${formatWhen(e.openedAt)}",
                style = MaterialTheme.typography.bodySmall, color = Atrium.colors.muted, maxLines = 1,
            )
        }
        IconButton(onClick = onForget) { Icon(painterResource(R.drawable.ic_close), contentDescription = "Remove from list", tint = Atrium.colors.ink2) }
    }
}

@Composable
fun StorageCard(used: Long, quota: Long, fraction: Float) {
    Surface(
        color = Atrium.colors.surface,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(painterResource(R.drawable.ic_drive), contentDescription = null, tint = Atrium.colors.drive, modifier = Modifier.size(18.dp))
                Text("Storage", style = MaterialTheme.typography.titleSmall, color = Atrium.colors.ink)
            }
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { fraction.coerceAtLeast(0.01f) },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                color = if (fraction > 0.9f) Atrium.colors.danger else Atrium.colors.accent,
                trackColor = Atrium.colors.surface2,
                drawStopIndicator = {},
            )
            Spacer(Modifier.height(8.dp))
            Text("${formatBytes(used)} of ${formatBytes(quota)} used", style = MaterialTheme.typography.bodySmall, color = Atrium.colors.ink2)
        }
    }
}

@Composable
fun Divider() = HorizontalDivider(color = Atrium.colors.line)
