package org.atrium.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.atrium.app.R
import org.atrium.app.data.Item
import org.atrium.app.data.Kind
import org.atrium.app.ui.theme.Atrium

private enum class Pending { NONE, RENAME, MOVE, DELETE }

/** Long-press / overflow menu for one item, plus the dialogs its actions need. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemActionsSheet(item: Item, folders: List<Item>, vm: AppViewModel, host: DriveHost, onOpen: () -> Unit, onDismiss: () -> Unit) {
    var pending by remember { mutableStateOf(Pending.NONE) }

    when (pending) {
        Pending.RENAME -> NameDialog(
            title = "Rename",
            initial = item.name,
            confirm = "Rename",
            onDismiss = onDismiss,
            onConfirm = { vm.rename(item, it); onDismiss() },
        )
        Pending.MOVE -> MoveDialog(item, folders, onDismiss = onDismiss, onMove = { vm.move(item, it); onDismiss() })
        Pending.DELETE -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Delete forever?") },
            text = { Text("“${item.name}”${if (item.kind == Kind.FOLDER) " and everything in it" else ""} will be deleted. This can't be undone.") },
            confirmButton = { TextButton(onClick = { vm.deleteForever(item); onDismiss() }) { Text("Delete forever", color = Atrium.colors.danger) } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        Pending.NONE -> ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Atrium.colors.surface,
        ) {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(bottom = 8.dp),
            ) {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ItemTile(item, size = 36.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.name, style = MaterialTheme.typography.titleMedium, color = Atrium.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            if (item.kind == Kind.FOLDER) "Folder" else "${item.kind.noun.replaceFirstChar { it.uppercase() }} · ${formatBytes(item.size)} · ${formatWhen(item.updatedAt)}",
                            style = MaterialTheme.typography.bodySmall, color = Atrium.colors.muted,
                        )
                    }
                }
                Divider()
                if (item.trashed) {
                    Action(R.drawable.ic_restore, "Restore") { vm.restore(item); onDismiss() }
                    Action(R.drawable.ic_delete, "Delete forever", danger = true) { pending = Pending.DELETE }
                } else {
                    Action(R.drawable.ic_open, if (item.isPdf) "Open and edit" else "Open") { onDismiss(); onOpen() }
                    Action(R.drawable.ic_share, if (item.shareId != null) "Share link" else "Create share link") {
                        vm.shareLink(item) { url -> host.shareLink(item.name, url) }
                        onDismiss()
                    }
                    if (item.shareId != null) Action(R.drawable.ic_link, "Turn off link") { vm.stopSharing(item); onDismiss() }
                    Action(R.drawable.ic_edit, "Rename") { pending = Pending.RENAME }
                    Action(if (item.starred) R.drawable.ic_star else R.drawable.ic_star_border, if (item.starred) "Remove from Starred" else "Add to Starred") {
                        vm.star(item); onDismiss()
                    }
                    Action(R.drawable.ic_move, "Move to folder") { pending = Pending.MOVE }
                    if (item.kind != Kind.FOLDER) Action(R.drawable.ic_copy, "Make a copy") { vm.copy(item); onDismiss() }
                    if (item.kind == Kind.FILE) Action(R.drawable.ic_download, "Download") { host.download(item); onDismiss() }
                    if (item.isPdf) {
                        for ((tool, label) in listOf(PdfTool.SPLIT to "Split PDF", PdfTool.OCR to "Make searchable (OCR)", PdfTool.TO_WORD to "Convert to Word", PdfTool.MERGE to "Merge with other PDFs")) {
                            Action(tool.icon, label) { onDismiss(); host.openPdfTool(tool.path, item.id) }
                        }
                    }
                    Action(R.drawable.ic_delete, "Move to trash", danger = true) { vm.trash(item); onDismiss() }
                }
            }
        }
    }
}

@Composable
private fun Action(icon: Int, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = if (danger) Atrium.colors.danger else Atrium.colors.ink2
        Icon(painterResource(icon), contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(20.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (danger) Atrium.colors.danger else Atrium.colors.ink)
    }
}

@Composable
fun NameDialog(title: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    // Select the name without its extension, like a desktop file manager.
    val end = initial.lastIndexOf('.').takeIf { it > 0 } ?: initial.length
    var value by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, end))) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val ok = value.text.isNotBlank() && value.text.length <= 200
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (ok) onConfirm(value.text) }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus),
            )
        },
        confirmButton = { TextButton(onClick = { onConfirm(value.text) }, enabled = ok) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun MoveDialog(item: Item, folders: List<Item>, onDismiss: () -> Unit, onMove: (String?) -> Unit) {
    // A folder can't go inside itself or anything below it.
    val byParent = folders.groupBy { it.parentId }
    val blocked = HashSet<String>()
    if (item.kind == Kind.FOLDER) {
        val stack = ArrayDeque(listOf(item.id))
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            if (blocked.add(id)) byParent[id]?.forEach { stack.add(it.id) }
        }
    }
    // Depth-first so each folder appears under its parent.
    val rows = ArrayList<Pair<Item, Int>>()
    fun walk(parent: String?, depth: Int) {
        byParent[parent].orEmpty().sortedBy { it.name.lowercase() }.forEach {
            if (it.id !in blocked) {
                rows.add(it to depth)
                walk(it.id, depth + 1)
            }
        }
    }
    walk(null, 1)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move “${item.name}”") },
        text = {
            LazyColumn(Modifier.heightIn(max = 360.dp)) {
                item { FolderChoice("My Drive", 0, current = item.parentId == null) { onMove(null) } }
                items(rows, key = { it.first.id }) { (f, depth) -> FolderChoice(f.name, depth, current = item.parentId == f.id) { onMove(f.id) } }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun FolderChoice(name: String, depth: Int, current: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = !current, onClick = onClick)
            .padding(start = (depth * 16).dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(if (depth == 0) R.drawable.ic_drive else R.drawable.ic_folder),
            contentDescription = null,
            tint = Atrium.colors.drive,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            if (current) "$name (current)" else name,
            color = if (current) Atrium.colors.muted else Atrium.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The + button's menu: the four editors, a folder, or a file from the phone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateSheet(onDismiss: () -> Unit, onCreate: (Kind, String?) -> Unit, onUpload: () -> Unit) {
    var naming by remember { mutableStateOf(false) }
    if (naming) {
        NameDialog("New folder", "Untitled folder", "Create", onDismiss = onDismiss) { onCreate(Kind.FOLDER, it) }
        return
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Atrium.colors.surface) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text("Create new", style = MaterialTheme.typography.titleMedium, color = Atrium.colors.ink, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            for (k in listOf(Kind.DOC, Kind.SHEET, Kind.SLIDES, Kind.NOTEBOOK)) {
                CreateRow({ KindTile(k, size = 36.dp) }, "New ${k.noun}") { onCreate(k, null) }
            }
            CreateRow({ KindTile(Kind.FOLDER, size = 36.dp) }, "New folder") { naming = true }
            Divider()
            CreateRow({
                Icon(painterResource(R.drawable.ic_upload), contentDescription = null, tint = Atrium.colors.accent, modifier = Modifier.size(36.dp).padding(6.dp))
            }, "Upload from this phone") { onUpload() }
        }
    }
}

@Composable
private fun CreateRow(icon: @Composable () -> Unit, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Atrium.colors.ink)
    }
}

