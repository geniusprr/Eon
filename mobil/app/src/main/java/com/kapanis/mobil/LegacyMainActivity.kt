package com.kapanis.mobil

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.kapanis.mobil.data.ConnectionMode
import com.kapanis.mobil.data.ConnectionTarget
import com.kapanis.mobil.data.PairedDeviceItem
import com.kapanis.mobil.data.PreferencesManager
import com.kapanis.mobil.network.KapanisApiClient
import com.kapanis.mobil.network.SupabaseRemoteClient
import com.kapanis.mobil.service.KapanisNotificationService
import com.kapanis.mobil.ui.screens.MainScreen
import com.kapanis.mobil.ui.theme.KapanisTheme

class LegacyMainActivity : ComponentActivity() {

    private lateinit var prefs: PreferencesManager
    private val apiClient = KapanisApiClient()
    private val supabaseClient = SupabaseRemoteClient()

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            KapanisNotificationService.start(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = PreferencesManager(this)
        val initialTarget = parseIntentUri(intent?.data)

        // Keep the local transfer receiver alive independently of notification
        // permission. Android may hide its notification when permission is
        // denied, but starting from this foreground Activity is still allowed.
        try {
            KapanisNotificationService.start(this)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } catch (e: Throwable) {
            // Prevent startup crash
        }

        setContent {
            var currentTheme by remember { mutableStateOf(prefs.themeMode) }

            KapanisTheme(darkTheme = currentTheme == "dark") {
                MainScreen(
                    prefs = prefs,
                    apiClient = apiClient,
                    supabaseClient = supabaseClient,
                    initialTarget = initialTarget,
                    currentTheme = currentTheme,
                    onToggleTheme = {
                        val next = if (currentTheme == "dark") "light" else "dark"
                        prefs.themeMode = next
                        currentTheme = next
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        try {
            val target = parseIntentUri(intent.data)
            if (target != null) {
                prefs.host = target.host
                prefs.port = target.port
                prefs.deviceName = target.deviceName
                setContent {
                    var currentTheme by remember { mutableStateOf(prefs.themeMode) }

                    KapanisTheme(darkTheme = currentTheme == "dark") {
                        MainScreen(
                            prefs = prefs,
                            apiClient = apiClient,
                            supabaseClient = supabaseClient,
                            initialTarget = target,
                            currentTheme = currentTheme,
                            onToggleTheme = {
                                val next = if (currentTheme == "dark") "light" else "dark"
                                prefs.themeMode = next
                                currentTheme = next
                            }
                        )
                    }
                }
            }
        } catch (e: Throwable) {
            // ignore
        }
    }

    private fun parseIntentUri(data: Uri?): ConnectionTarget? {
        if (data == null) return null

        try {
            val pairData = try { data.getQueryParameter("pair_data") } catch (e: Throwable) { null }
            if (!pairData.isNullOrEmpty()) {
                val payload = PreferencesManager.parsePairingPayload(pairData)
                if (payload != null) {
                    val item = PairedDeviceItem(
                        id = payload.id,
                        name = payload.name,
                        host = payload.ips.firstOrNull() ?: "192.168.1.100",
                        port = payload.port,
                        mode = if (payload.url.isNotEmpty()) ConnectionMode.ONLINE else ConnectionMode.LOCAL,
                        pairingCode = payload.code,
                        pairingSecret = payload.secret,
                        supabaseUrl = payload.url,
                        supabaseAnonKey = payload.key,
                        localIps = payload.ips,
                        ntfyTopic = payload.ntfy
                    )
                    prefs.savePairedDevice(item)
                    if (item.host.isNotBlank() && item.host != "192.168.1.100") {
                        prefs.host = item.host
                        prefs.port = item.port
                    }
                    if (item.mode == ConnectionMode.ONLINE) {
                        prefs.mode = ConnectionMode.ONLINE
                        prefs.supabaseUrl = item.supabaseUrl
                        prefs.supabaseAnonKey = item.supabaseAnonKey
                        prefs.pairedDeviceId = item.id
                        prefs.pairingCode = item.pairingCode
                    } else {
                        prefs.mode = ConnectionMode.LOCAL
                        prefs.host = item.host
                        prefs.port = item.port
                    }
                    prefs.deviceName = item.name
                    return ConnectionTarget(
                        host = item.host,
                        port = item.port,
                        deviceName = item.name,
                        isConnected = true
                    )
                }
            }

            if (data.scheme != "kapanis") return null

            // Parse Online parameters
            val code = try { data.getQueryParameter("code") } catch (e: Throwable) { null }
            val supabaseUrl = try { data.getQueryParameter("supabaseUrl") } catch (e: Throwable) { null }
            val supabaseKey = try { data.getQueryParameter("supabaseKey") } catch (e: Throwable) { null }
            val name = try { data.getQueryParameter("name") } catch (e: Throwable) { null } ?: "Windows PC"

            if (!code.isNullOrEmpty()) {
                prefs.pairingCode = code
                if (!supabaseUrl.isNullOrEmpty()) prefs.supabaseUrl = supabaseUrl
                if (!supabaseKey.isNullOrEmpty()) prefs.supabaseAnonKey = supabaseKey
                prefs.deviceName = name
                prefs.mode = ConnectionMode.ONLINE
            }

            // Parse Local parameters
            val host = try { data.getQueryParameter("host") } catch (e: Throwable) { null } ?: return null
            val port = try { data.getQueryParameter("port")?.toIntOrNull() } catch (e: Throwable) { null } ?: 53317
            prefs.host = host
            prefs.port = port
            prefs.deviceName = name

            return ConnectionTarget(
                host = host,
                port = port,
                deviceName = name,
                isConnected = false
            )
        } catch (e: Throwable) {
            return null
        }
    }
}

