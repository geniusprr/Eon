package com.kapanis.mobil.eon2.ui

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize

private val LocalDeckFrame = compositionLocalOf<State<DeckFrame>?> { null }

private data class DeckFrame(val origin: Offset = Offset.Zero, val size: Size = Size.Zero)

@Composable
internal fun DeckGlassBackdrop(content: @Composable BoxScope.() -> Unit) {
    val frame = remember { mutableStateOf(DeckFrame()) }
    Box(Modifier.fillMaxSize()
        .onGloballyPositioned { frame.value = DeckFrame(it.positionInRoot(), it.size.toSize()) }
        .drawDeckGlass()) {
        CompositionLocalProvider(
            LocalDeckFrame provides frame,
            LocalContentColor provides MaterialTheme.colorScheme.onSurface,
        ) { content() }
    }
}

@Composable
internal fun Modifier.deckGlass(radius: Dp = eonPanelRadius, accent: Color = Color.Transparent): Modifier {
    val shape = remember(radius) { RoundedCornerShape(radius) }
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    val edge = remember(dark) {
        Brush.linearGradient(listOf(
            Color.White.copy(alpha = if (dark) .38f else .95f),
            Color(0xFF7E97B5).copy(alpha = .16f),
            Color.White.copy(alpha = if (dark) .20f else .64f),
        ))
    }
    return clip(shape).drawDeckGlass(radius, accent).border(1.dp, edge, shape)
}

@Composable
private fun Modifier.drawDeckGlass(radius: Dp = 0.dp, accent: Color = Color.Transparent): Modifier {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.background.luminance() < .5f
    val frame = LocalDeckFrame.current
    val isSurface = radius > 0.dp
    val origin = remember { mutableStateOf(Offset.Zero) }
    val shader = if (Build.VERSION.SDK_INT >= 33) remember { createDeckShader() } else null
    val brush = remember(shader) { shader?.let(::ShaderBrush) }
    val start = if (dark) Color(0xFF558DE5) else Color(0xFF90BFF7)
    val end = if (dark) Color(0xFF8181CD) else Color(0xFFB8B5F0)
    val tracked = if (isSurface) onGloballyPositioned { origin.value = it.positionInRoot() } else this
    return tracked.drawWithCache {
        val bounds = frame?.value
        val viewport = bounds?.size?.takeUnless { it.isEmpty() } ?: size
        val offset = if (bounds == null) Offset.Zero else origin.value - bounds.origin
        val tint = accent.takeUnless { it == Color.Transparent } ?: scheme.primary
        val rounding = radius.toPx().coerceAtMost(size.minDimension / 2f)
        if (Build.VERSION.SDK_INT >= 33 && shader != null && brush != null) {
            shader.setFloatUniform("viewport", viewport.width.coerceAtLeast(1f), viewport.height.coerceAtLeast(1f))
            shader.setFloatUniform("dimensions", size.width, size.height)
            shader.setFloatUniform("origin", offset.x, offset.y)
            shader.setFloatUniform("radius", rounding)
            shader.setFloatUniform("glass", if (isSurface) 1f else 0f)
            shader.setFloatUniform("dark", if (dark) 1f else 0f)
            shader.setColorUniform("ground", scheme.background.toArgb())
            shader.setColorUniform("surface", scheme.surface.toArgb())
            shader.setColorUniform("blueLight", start.toArgb())
            shader.setColorUniform("violetLight", end.toArgb())
            shader.setColorUniform("tint", tint.toArgb())
            onDrawBehind { drawRect(brush) }
        } else {
            val fill = if (isSurface) scheme.surface.copy(alpha = if (dark) .66f else .73f) else scheme.background
            val highlight = Brush.linearGradient(listOf(
                (if (isSurface) Color.White else start).copy(alpha = if (dark) .14f else .55f),
                Color.Transparent, (if (isSurface) tint else end).copy(alpha = if (dark) .13f else .31f),
            ))
            onDrawBehind { drawRect(fill); drawRect(highlight) }
        }
    }
}

@RequiresApi(33)
private fun createDeckShader() = RuntimeShader(
    """
    uniform float2 viewport, dimensions, origin;
    uniform float radius, glass, dark;
    layout(color) uniform half4 ground, surface, blueLight, violetLight, tint;

    half3 backdrop(float2 position) {
        float2 uv = position / viewport;
        float2 blue = (uv - float2(0.17, 0.02)) * float2(1.4, 0.8);
        float2 violet = (uv - float2(0.86, 0.85)) * float2(1.45, 0.85);
        half3 color = mix(ground.rgb, blueLight.rgb, half((1.0 - smoothstep(0.0, 0.77, length(blue))) * mix(0.48, 0.30, dark)));
        return mix(color, violetLight.rgb, half((1.0 - smoothstep(0.0, 0.72, length(violet))) * mix(0.42, 0.23, dark)));
    }

    half4 main(float2 position) {
        if (glass < 0.5) return half4(backdrop(position), 1);

        // The rounded rectangle's distance field gives the direction and width of its curved rim.
        float2 local = position - dimensions * 0.5;
        float2 edge = abs(local) - dimensions * 0.5 + radius;
        float2 outer = max(edge, 0.0);
        float distance = radius - (length(outer) + min(max(edge.x, edge.y), 0.0));
        float2 axis = edge.x > edge.y ? float2(1, 0) : float2(0, 1);
        float2 normal = sign(local) * (length(outer) > 0.001 ? normalize(outer) : axis);
        float bevel = 1.0 - smoothstep(0.0, max(1.0, radius * 0.40), distance);
        float2 sampleAt = origin + position - normal * bevel * bevel * radius * 0.85;
        half3 color = mix(backdrop(sampleAt), surface.rgb, half(mix(0.64, 0.58, dark)));
        float diagonal = clamp(dot(position / max(dimensions, 1.0), float2(0.48, 0.52)), 0.0, 1.0);
        color = mix(color, tint.rgb, half((1.0 - diagonal) * mix(0.035, 0.07, dark)));
        float glare = max(0.0, dot(normal, float2(-0.56, -0.83)));
        return half4(mix(color, half3(1), half(bevel * (0.025 + glare * mix(0.34, 0.19, dark)))), 1);
    }
    """.trimIndent(),
)
