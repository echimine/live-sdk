package fr.echimine.live.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Les 4 jetons de thème des écrans du Live. Clair ou sombre suit le système.
 *
 * @property accent couleur des actions principales (« Lancer », sélection).
 * @property cornerRadius arrondi des boutons, champs et cartes.
 * @property fontFamily police de tous les textes des écrans.
 * @property label libellé du Live, affiché en haut de l'écran (« Crosslive » par défaut).
 */
@Immutable
public data class LiveTheme(
    val accent: Color = Color(0xFFFF2D55),
    val cornerRadius: Dp = 14.dp,
    val fontFamily: FontFamily = FontFamily.Default,
    val label: String = "Crosslive",
)

/** Thème courant des écrans du Live ; à fournir avec [LiveSdkTheme]. */
public val LocalLiveTheme: androidx.compose.runtime.ProvidableCompositionLocal<LiveTheme> =
    staticCompositionLocalOf { LiveTheme() }

/**
 * Applique [theme] aux écrans du Live qu'il contient. Sans lui, les écrans prennent
 * le dernier thème fourni plus haut, ou le thème par défaut.
 */
@Composable
public fun LiveSdkTheme(
    theme: LiveTheme = LocalLiveTheme.current,
    content: @Composable () -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val onAccent = if (theme.accent.luminance() > 0.5f) Color.Black else Color.White
    val colors = if (dark) {
        darkColorScheme(primary = theme.accent, onPrimary = onAccent)
    } else {
        lightColorScheme(primary = theme.accent, onPrimary = onAccent)
    }
    val shape = RoundedCornerShape(theme.cornerRadius)
    CompositionLocalProvider(LocalLiveTheme provides theme) {
        MaterialTheme(
            colorScheme = colors,
            shapes = Shapes(small = shape, medium = shape, large = shape),
            typography = Typography().withFont(theme.fontFamily),
            content = content,
        )
    }
}

private fun Typography.withFont(family: FontFamily): Typography {
    fun TextStyle.withFamily() = copy(fontFamily = family)
    return copy(
        displayLarge = displayLarge.withFamily(), displayMedium = displayMedium.withFamily(), displaySmall = displaySmall.withFamily(),
        headlineLarge = headlineLarge.withFamily(), headlineMedium = headlineMedium.withFamily(), headlineSmall = headlineSmall.withFamily(),
        titleLarge = titleLarge.withFamily(), titleMedium = titleMedium.withFamily(), titleSmall = titleSmall.withFamily(),
        bodyLarge = bodyLarge.withFamily(), bodyMedium = bodyMedium.withFamily(), bodySmall = bodySmall.withFamily(),
        labelLarge = labelLarge.withFamily(), labelMedium = labelMedium.withFamily(), labelSmall = labelSmall.withFamily(),
    )
}
