package org.atrium.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.atrium.app.R
import org.atrium.app.data.Item
import org.atrium.app.data.Kind
import org.atrium.app.ui.theme.Atrium

/**
 * Atrium's apps, as on the web's home page. Each one is a view of the drive: its files, newest first,
 * with + making a new one. PDF has no editor of its own, so it lists PDFs and offers the PDF tools.
 */
enum class AtriumApp(val label: String, val kind: Kind?, val icon: Int) {
    DOCS("Docs", Kind.DOC, R.drawable.ic_doc),
    SHEETS("Sheets", Kind.SHEET, R.drawable.ic_sheet),
    SLIDES("Slides", Kind.SLIDES, R.drawable.ic_slides),
    NOTEBOOK("Notebook", Kind.NOTEBOOK, R.drawable.ic_notebook),
    PDF("PDF", null, R.drawable.ic_pdf);

    fun holds(item: Item) = if (kind == null) item.isPdf else item.kind == kind

    val empty
        get() = when (this) {
            PDF -> "No PDFs yet. Use a tool above, or upload one with +."
            else -> "No ${kind!!.noun}s yet. Tap + to create one."
        }
}

/** The PDF red, matching the web's PDF tool tile. */
private const val PDF_RED = 0xFFE5322D

@Composable
fun appColor(app: AtriumApp): Color = app.kind?.let { Atrium.colors.of(it) } ?: Color(PDF_RED)

/** A row of app tiles at the top of the drive. */
@Composable
fun AppsStrip(onOpen: (AtriumApp) -> Unit) {
    Column(Modifier.padding(top = 8.dp)) {
        Text(
            "Apps",
            style = MaterialTheme.typography.labelLarge,
            color = Atrium.colors.ink2,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
        )
        Row(
            Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (app in AtriumApp.entries) {
                val color = appColor(app)
                Column(
                    Modifier
                        .width(72.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { onOpen(app) }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .size(48.dp)
                            .background(color.copy(alpha = 0.14f), RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(painterResource(app.icon), contentDescription = null, tint = color, modifier = Modifier.size(26.dp))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(app.label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Atrium.colors.ink, maxLines = 1)
                }
            }
        }
    }
}
