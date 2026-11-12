package com.kapanis.mobil.eon2.ui

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import com.kapanis.mobil.R

/** Reuses the exact planet artwork embedded in the Android launcher icon. */
@Composable
fun EonPlanetLogo(
    modifier: Modifier = Modifier,
    tint: Color = Color.Unspecified,
    contentDescription: String? = "Eon",
) {
    Icon(
        painter = painterResource(id = R.drawable.eon_launcher_foreground),
        contentDescription = contentDescription,
        modifier = modifier,
        tint = tint,
    )
}
