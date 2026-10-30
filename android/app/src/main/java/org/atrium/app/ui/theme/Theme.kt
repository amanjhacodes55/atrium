package org.atrium.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import org.atrium.app.data.Kind

/** The web app's palette (src/app/globals.css), so the native screens and the editors look like one product. */
@Immutable
data class AtriumColors(
    val plane: Color,
    val surface: Color,
    val surface2: Color,
    val hover: Color,
    val ink: Color,
    val ink2: Color,
    val muted: Color,
    val line: Color,
    val accent: Color,
    val accentInk: Color,
    val accentWash: Color,
    val danger: Color,
    val doc: Color,
    val sheet: Color,
    val slides: Color,
    val drive: Color,
    val notebook: Color,
) {
    fun of(kind: Kind): Color = when (kind) {
        Kind.DOC -> doc
        Kind.SHEET -> sheet
        Kind.SLIDES -> slides
        Kind.NOTEBOOK -> notebook
        Kind.FOLDER -> drive
        Kind.FILE -> muted
    }
}

private val Light = AtriumColors(
    plane = Color(0xFFF5F6F8), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFF0F2F5), hover = Color(0xFFEEF0F4),
    ink = Color(0xFF111827), ink2 = Color(0xFF4B5563), muted = Color(0xFF8A919E), line = Color(0xFFE3E6EB),
    accent = Color(0xFF2563EB), accentInk = Color(0xFF1D4ED8), accentWash = Color(0x1A2563EB), danger = Color(0xFFDC2626),
    doc = Color(0xFF2563EB), sheet = Color(0xFF16A34A), slides = Color(0xFFEA580C), drive = Color(0xFFCA8A04), notebook = Color(0xFF7C3AED),
)

private val Dark = AtriumColors(
    plane = Color(0xFF0F1115), surface = Color(0xFF181B21), surface2 = Color(0xFF20242B), hover = Color(0xFF262A32),
    ink = Color(0xFFEEF0F3), ink2 = Color(0xFFB5BCC8), muted = Color(0xFF7D8592), line = Color(0xFF2B3038),
    accent = Color(0xFF60A5FA), accentInk = Color(0xFF93C5FD), accentWash = Color(0x2460A5FA), danger = Color(0xFFF87171),
    doc = Color(0xFF60A5FA), sheet = Color(0xFF4ADE80), slides = Color(0xFFFB923C), drive = Color(0xFFFACC15), notebook = Color(0xFFC084FC),
)

private val LocalAtriumColors = staticCompositionLocalOf { Light }

object Atrium {
    val colors: AtriumColors
        @Composable @ReadOnlyComposable get() = LocalAtriumColors.current
}

@Composable
fun AtriumTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) Dark else Light
    val scheme = if (dark) {
        darkColorScheme(
            primary = c.accent, onPrimary = Color(0xFF0B1220), primaryContainer = c.accentWash, onPrimaryContainer = c.accentInk,
            secondary = c.accent, secondaryContainer = c.accentWash, onSecondaryContainer = c.accentInk,
            background = c.plane, onBackground = c.ink, surface = c.surface, onSurface = c.ink,
            surfaceVariant = c.surface2, onSurfaceVariant = c.ink2, surfaceContainer = c.surface, surfaceContainerLow = c.surface,
            surfaceContainerHigh = c.surface2, surfaceContainerHighest = c.surface2, surfaceContainerLowest = c.plane,
            outline = c.line, outlineVariant = c.line, error = c.danger,
        )
    } else {
        lightColorScheme(
            primary = c.accent, onPrimary = Color.White, primaryContainer = c.accentWash, onPrimaryContainer = c.accentInk,
            secondary = c.accent, secondaryContainer = Color(0xFFDBE7FD), onSecondaryContainer = c.accentInk,
            background = c.plane, onBackground = c.ink, surface = c.surface, onSurface = c.ink,
            surfaceVariant = c.surface2, onSurfaceVariant = c.ink2, surfaceContainer = c.surface, surfaceContainerLow = c.surface,
            surfaceContainerHigh = c.surface, surfaceContainerHighest = c.surface2, surfaceContainerLowest = c.surface,
            outline = c.line, outlineVariant = c.line, error = c.danger,
        )
    }
    val base = Typography()
    val type = base.copy(
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalAtriumColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
