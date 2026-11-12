package com.kapanis.mobil

import android.os.Build
import android.os.Bundle
import android.content.res.Configuration
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalConfiguration
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.kapanis.mobil.eon2.ui.Eon2Screen
import com.kapanis.mobil.eon2.ui.EonTheme
import com.kapanis.mobil.eon2.ui.EonGlassBackdrop

class MainActivity : ComponentActivity() {
    private var theme by mutableStateOf("obsidian")
    private val dark get() = theme != "light"

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        val preferences = getSharedPreferences("eon2-ui", MODE_PRIVATE)
        theme = preferences.getString("theme", null) ?: if (preferences.getBoolean("dark", true)) "obsidian" else "light"
        setContent {
            EonTheme(theme) {
                val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
                DisposableEffect(landscape, dark) {
                    val controller = WindowCompat.getInsetsController(window, window.decorView)
                    controller.isAppearanceLightStatusBars = !dark
                    controller.isAppearanceLightNavigationBars = !dark
                    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    if (landscape) {
                        controller.hide(WindowInsetsCompat.Type.systemBars())
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else controller.show(WindowInsetsCompat.Type.systemBars())
                    onDispose {
                        controller.show(WindowInsetsCompat.Type.systemBars())
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                }
                EonGlassBackdrop {
                    Eon2Screen(theme = theme, onTheme = { next ->
                        if (theme != next) {
                            theme = next
                            preferences.edit().putString("theme", next).apply()
                        }
                    })
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
}
