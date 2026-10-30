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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.atrium.app.R
import org.atrium.app.ui.theme.Atrium

/**
 * The web app's PDF tools (`/pdf/<id>`). They run entirely in the page, on the phone, so the app
 * opens them in the editor WebView, which already handles picking files and saving downloads.
 */
enum class PdfTool(val path: String, val label: String, val icon: Int, val color: Long) {
    MERGE("merge", "Merge", R.drawable.ic_merge, 0xFFE5322D),
    SPLIT("split", "Split", R.drawable.ic_scissors, 0xFFF59E0B),
    EDIT("edit", "Edit", R.drawable.ic_edit, 0xFF7C3AED),
    CREATE("create", "Create", R.drawable.ic_add_photo, 0xFF0EA5E9),
    OCR("ocr", "OCR", R.drawable.ic_scan, 0xFF16A34A),
    TO_WORD("pdf-to-word", "PDF to Word", R.drawable.ic_doc, 0xFF2563EB),
    TO_PDF("word-to-pdf", "Word to PDF", R.drawable.ic_pdf, 0xFF1D4ED8),
}

/** A row of PDF tool tiles at the top of the drive. */
@Composable
fun PdfToolsStrip(onOpen: (PdfTool) -> Unit) {
    Column(Modifier.padding(top = 4.dp, bottom = 8.dp)) {
        Text(
            "PDF tools",
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
            for (tool in PdfTool.entries) {
                Column(
                    Modifier
                        .width(76.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { onOpen(tool) }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .size(48.dp)
                            .background(Color(tool.color), RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(painterResource(tool.icon), contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        tool.label,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Atrium.colors.ink,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                    )
                }
            }
        }
    }
}
