package org.atrium.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.atrium.app.R
import org.atrium.app.data.Item
import org.atrium.app.data.Kind
import org.atrium.app.ui.theme.Atrium
import java.text.DateFormat
import java.util.Calendar
import java.util.Locale

fun kindIcon(kind: Kind, mime: String? = null): Int = when (kind) {
    Kind.DOC -> R.drawable.ic_doc
    Kind.SHEET -> R.drawable.ic_sheet
    Kind.SLIDES -> R.drawable.ic_slides
    Kind.NOTEBOOK -> R.drawable.ic_notebook
    Kind.FOLDER -> R.drawable.ic_folder
    Kind.FILE -> when {
        mime?.startsWith("image/") == true -> R.drawable.ic_image
        mime == "application/pdf" -> R.drawable.ic_pdf
        else -> R.drawable.ic_file
    }
}

/** The coloured tile the web app uses for each kind of item. */
@Composable
fun KindTile(kind: Kind, mime: String? = null, size: Dp = 40.dp) {
    val color = Atrium.colors.of(kind)
    Box(
        Modifier
            .size(size)
            .background(color.copy(alpha = 0.12f), RoundedCornerShape(size / 4)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(kindIcon(kind, mime)), contentDescription = kind.noun, tint = color, modifier = Modifier.size(size * 0.55f))
    }
}

@Composable
fun ItemTile(item: Item, size: Dp = 40.dp) = KindTile(item.kind, item.mime, size)

/** Same rules as the web's formatBytes. */
fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> if (n < 10240) String.format(Locale.US, "%.1f KB", n / 1024.0) else "${n / 1024} KB"
    n < 1024L * 1024 * 1024 -> String.format(Locale.US, "%.1f MB", n / 1048576.0)
    else -> String.format(Locale.US, "%.1f GB", n / 1073741824.0)
}

/** A time today, otherwise a short date (with the year only when it isn't this year). */
fun formatWhen(ms: Long): String {
    val now = Calendar.getInstance()
    val then = Calendar.getInstance().apply { timeInMillis = ms }
    val sameDay = now.get(Calendar.YEAR) == then.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == then.get(Calendar.DAY_OF_YEAR)
    if (sameDay) return DateFormat.getTimeInstance(DateFormat.SHORT).format(then.time)
    val pattern = if (now.get(Calendar.YEAR) == then.get(Calendar.YEAR)) "MMM d" else "MMM d, yyyy"
    return java.text.SimpleDateFormat(pattern, Locale.getDefault()).format(then.time)
}
