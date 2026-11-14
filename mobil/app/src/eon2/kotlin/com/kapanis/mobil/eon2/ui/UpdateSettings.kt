package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.kapanis.mobil.eon2.network.MobileUpdateState
import com.kapanis.mobil.eon2.network.ReleaseUpdater

@Composable
fun UpdateSettings(updater: ReleaseUpdater, state: MobileUpdateState) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Güncellemeler", style = MaterialTheme.typography.titleLarge)
        Text("Eon ${updater.currentVersion}", style = MaterialTheme.typography.bodyMedium)
        Text(state.message, style = MaterialTheme.typography.bodyMedium)
        if (state.phase == "downloading") LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth())
        if (state.phase == "downloaded") {
            Text("v${state.version} indirildi. Kurulum Android onayınla başlar; açık notlarını kaydet.", style = MaterialTheme.typography.bodySmall)
            Button(shape = MaterialTheme.shapes.medium, onClick = { updater.install() }) { Text("Yeni sürümü kur") }
        } else OutlinedButton(shape = MaterialTheme.shapes.medium, onClick = { updater.check(manual = true) }, enabled = state.phase != "downloading" && state.phase != "checking") {
            Text(if (state.phase == "error") "Yeniden dene" else "Güncellemeleri denetle")
        }
        Text("USB bağlıyken masaüstü Eon da onayınla telefonunu güncelleyebilir.", style = MaterialTheme.typography.bodySmall)
    }
}
