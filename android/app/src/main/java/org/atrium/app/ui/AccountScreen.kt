package org.atrium.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import org.atrium.app.R
import org.atrium.app.data.Usage
import org.atrium.app.data.User
import org.atrium.app.ui.theme.Atrium

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(user: User, usage: Usage?, server: String, onBack: () -> Unit, onSignOut: () -> Unit, onOpenWeb: (String) -> Unit) {
    BackHandler(onBack = onBack)
    var confirm by remember { mutableStateOf(false) }
    Scaffold(
        containerColor = Atrium.colors.plane,
        topBar = {
            TopAppBar(
                title = { Text("Account") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Atrium.colors.plane),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Avatar(user.name, size = 72)
            Spacer(Modifier.height(12.dp))
            Text(user.name, style = MaterialTheme.typography.titleLarge, color = Atrium.colors.ink)
            Text(if (user.guest) "Guest workspace" else user.email, style = MaterialTheme.typography.bodyMedium, color = Atrium.colors.ink2)
            if (user.guest) {
                Spacer(Modifier.height(16.dp))
                Surface(color = Atrium.colors.accentWash, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("You're using a guest workspace", style = MaterialTheme.typography.titleSmall, color = Atrium.colors.ink)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Create an account to keep these files. Signing out of a guest workspace loses them.",
                            style = MaterialTheme.typography.bodySmall, color = Atrium.colors.ink2,
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { onOpenWeb("$server/signup") }) { Text("Create account") }
                    }
                }
            }
            usage?.let { StorageCard(it.used, it.quota, it.fraction) }
            OutlinedButton(onClick = { onOpenWeb("$server/account") }, modifier = Modifier.fillMaxWidth()) { Text("Account settings") }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { if (user.guest) confirm = true else onSignOut() }, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out", color = Atrium.colors.danger)
            }
            Spacer(Modifier.height(24.dp))
            Text("Server: ${server.substringAfter("://")}", style = MaterialTheme.typography.labelSmall, color = Atrium.colors.muted)
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of the guest workspace?") },
            text = { Text("Guest workspaces have no password, so you won't be able to get back to these files.") },
            confirmButton = { TextButton(onClick = { confirm = false; onSignOut() }) { Text("Sign out", color = Atrium.colors.danger) } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}
