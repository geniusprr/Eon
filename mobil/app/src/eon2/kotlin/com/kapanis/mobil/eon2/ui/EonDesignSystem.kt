package com.kapanis.mobil.eon2.ui

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawPlainBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.backdrops.layerBackdrop

private val LocalGlassBackdrop = staticCompositionLocalOf<Backdrop?> { null }
private val LocalGlassEffects = staticCompositionLocalOf { false }

/** All five themes share the same semantic roles, including Material container colors. */
@Composable
internal fun EonTheme(theme: String, content: @Composable () -> Unit) {
    val colors = remember(theme) {
        val appearance = eonAppearances.firstOrNull { it.id == theme } ?: eonAppearances.first()
        val accent = appearance.accent
        val ground = appearance.ground
        val panel = lerp(ground, accent, .065f)
        if (theme == "light") lightColorScheme(
            primary = Color(0xFF245E50), onPrimary = Color.White,
            primaryContainer = Color(0xFFD5EAE3), onPrimaryContainer = Color(0xFF163F35),
            secondary = Color(0xFF49665F), onSecondary = Color.White,
            secondaryContainer = Color(0xFFE0EBE6), onSecondaryContainer = Color(0xFF263F37),
            tertiary = Color(0xFF566582), tertiaryContainer = Color(0xFFE1E7F2),
            onTertiaryContainer = Color(0xFF253653),
            background = Color(0xFFF0F4F2), onBackground = Color(0xFF162A25),
            surface = Color(0xFFFAFCFB), onSurface = Color(0xFF162A25),
            surfaceVariant = Color(0xFFE3EBE7), onSurfaceVariant = Color(0xFF52635C),
            surfaceDim = Color(0xFFDEE7E1), surfaceBright = Color.White,
            surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF6F9F7),
            surfaceContainer = Color(0xFFEDF3EF), surfaceContainerHigh = Color(0xFFE5EDE8),
            surfaceContainerHighest = Color(0xFFDDE7E1),
            outline = Color(0xFF8EAAA0), outlineVariant = Color(0xFFCCDAD2),
        ) else darkColorScheme(
            primary = accent, onPrimary = ground,
            primaryContainer = lerp(ground, accent, .17f), onPrimaryContainer = accent,
            secondary = lerp(accent, Color.White, .1f), onSecondary = ground,
            secondaryContainer = lerp(ground, accent, .11f), onSecondaryContainer = Color(0xFFE7EEF2),
            tertiary = accent, tertiaryContainer = lerp(ground, accent, .12f), onTertiaryContainer = accent,
            background = ground, onBackground = Color(0xFFF2F5F7),
            surface = panel, onSurface = Color(0xFFF2F5F7),
            surfaceVariant = lerp(ground, accent, .12f), onSurfaceVariant = lerp(accent, Color.White, .15f).copy(alpha = .76f),
            surfaceDim = ground, surfaceBright = lerp(ground, accent, .16f),
            surfaceContainerLowest = ground, surfaceContainerLow = panel,
            surfaceContainer = lerp(ground, accent, .09f),
            surfaceContainerHigh = lerp(ground, accent, .13f),
            surfaceContainerHighest = lerp(ground, accent, .17f),
            outline = lerp(ground, accent, .28f), outlineVariant = lerp(ground, accent, .16f),
        )
    }
    val typography = remember {
        val base = Typography()
        base.copy(
            headlineLarge = base.headlineLarge.copy(fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Medium, letterSpacing = (-.8).sp),
            headlineMedium = base.headlineMedium.copy(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, letterSpacing = (-.6).sp),
            titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Medium, letterSpacing = (-.35).sp),
            bodyMedium = base.bodyMedium.copy(lineHeight = 21.sp),
            labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
        )
    }
    MaterialTheme(colorScheme = colors, typography = typography, shapes = Shapes(
        small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(16.dp),
        large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(32.dp),
    ), content = content)
}

/** A single static source: panels never sample each other or allocate their own timers. */
@Composable
internal fun EonGlassBackdrop(content: @Composable () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val backdrop = rememberLayerBackdrop()
    val context = LocalContext.current.applicationContext
    val effects = remember(context) {
        Build.VERSION.SDK_INT >= 31 && !(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
    }
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().layerBackdrop(backdrop).drawWithCache {
            val wash = Brush.linearGradient(listOf(scheme.background,
                lerp(scheme.background, scheme.primary, .09f), scheme.background))
            val light = Brush.radialGradient(listOf(scheme.primary.copy(alpha = .10f), Color.Transparent),
                center = Offset(size.width * .9f, size.height * .12f), radius = size.maxDimension * .6f)
            onDrawBehind { drawRect(wash); drawRect(light) }
        })
        CompositionLocalProvider(LocalGlassBackdrop provides backdrop, LocalGlassEffects provides effects,
            LocalContentColor provides scheme.onBackground, content = content)
    }
}

/** Optical edge + tinted surface. Android 8–11/low RAM retains contrast without GPU effects. */
@Composable
internal fun Modifier.eonGlass(
    shape: RoundedCornerShape = RoundedCornerShape(24.dp),
    backdrop: Backdrop? = LocalGlassBackdrop.current,
    prominent: Boolean = false,
): Modifier {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.background.luminance() < .5f
    val effects = LocalGlassEffects.current
    val tint = scheme.surface.copy(alpha = if (prominent) .78f else .72f)
    val rim = remember(scheme, dark) { Brush.linearGradient(listOf(
        scheme.onSurface.copy(alpha = if (dark) .24f else .16f),
        scheme.primary.copy(alpha = .05f), scheme.onSurface.copy(alpha = .12f))) }
    val sheen = remember(scheme, dark) { Brush.linearGradient(listOf(
        Color.White.copy(alpha = if (dark) .045f else .45f), Color.Transparent,
        scheme.primary.copy(alpha = .035f))) }
    val material = if (effects && backdrop != null) Modifier.drawPlainBackdrop(
        backdrop = backdrop, shape = { shape }, effects = {
            blur(if (prominent) 10.dp.toPx() else 5.dp.toPx())
            if (Build.VERSION.SDK_INT >= 33) lens(10.dp.toPx(), 14.dp.toPx())
        }, onDrawSurface = { drawRect(tint) },
    ) else Modifier.background(scheme.surface.copy(alpha = .96f), shape)
    return this.then(material).clip(shape).background(sheen).border(.75.dp, rim, shape)
}
