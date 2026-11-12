package com.kapanis.mobil.eon2.ui

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

internal fun isTimedPowerAction(kind: String, delaySeconds: Long) =
    (kind == "shutdown" || kind == "restart") && delaySeconds > 0

internal fun powerDeadline(targetAt: Long, sampledAt: Long): Long? =
    if (targetAt > sampledAt) SystemClock.elapsedRealtime() + (targetAt - sampledAt) else null

internal fun isPowerCountdownActive(deadline: Long?) =
    deadline != null && deadline > SystemClock.elapsedRealtime()

@Composable
internal fun powerCountdown(deadline: Long?): String? {
    if (deadline == null) return null
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var remaining by remember(deadline) { mutableLongStateOf(deadline - SystemClock.elapsedRealtime()) }
    LaunchedEffect(deadline, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            remaining = deadline - SystemClock.elapsedRealtime()
            while (remaining > 0) {
                val boundary = remaining % 1000
                delay(if (boundary == 0L) 1000 else boundary)
                remaining = deadline - SystemClock.elapsedRealtime()
            }
        }
    }
    if (remaining <= 0) return null
    val seconds = (remaining + 999) / 1000
    val minutes = seconds / 60
    val hours = minutes / 60
    val clock = "${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}"
    return if (hours > 0) "$hours:$clock" else clock
}
