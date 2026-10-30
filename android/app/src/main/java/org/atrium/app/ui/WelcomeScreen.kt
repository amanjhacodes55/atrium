package org.atrium.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.atrium.app.R
import org.atrium.app.data.Kind
import org.atrium.app.ui.theme.Atrium

private enum class AuthMode { WELCOME, LOGIN, SIGNUP }

@Composable
fun WelcomeScreen(auth: AuthState, server: String, onGuest: () -> Unit, onLogin: (String, String) -> Unit, onSignup: (String, String, String) -> Unit, onClearError: () -> Unit) {
    var mode by rememberSaveable { mutableStateOf(AuthMode.WELCOME) }
    BackHandler(enabled = mode != AuthMode.WELCOME) {
        onClearError()
        mode = AuthMode.WELCOME
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Atrium.colors.plane)
            .safeDrawingPadding()
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 440.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (mode == AuthMode.WELCOME) {
                Welcome(auth, server, onGuest, { onClearError(); mode = AuthMode.LOGIN }, { onClearError(); mode = AuthMode.SIGNUP })
            } else {
                AuthForm(signup = mode == AuthMode.SIGNUP, auth = auth, onBack = { onClearError(); mode = AuthMode.WELCOME }, onLogin = onLogin, onSignup = onSignup, onSwitch = {
                    onClearError()
                    mode = if (mode == AuthMode.LOGIN) AuthMode.SIGNUP else AuthMode.LOGIN
                })
            }
        }
    }
}

@Composable
private fun Logo() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(shape = RoundedCornerShape(10.dp), color = Atrium.colors.accent, modifier = Modifier.size(36.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_launcher_monochrome), contentDescription = null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(56.dp))
            }
        }
        Text("Atrium", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Atrium.colors.ink)
    }
}

@Composable
private fun Welcome(auth: AuthState, server: String, onGuest: () -> Unit, onLogin: () -> Unit, onSignup: () -> Unit) {
    Logo()
    Spacer(Modifier.height(28.dp))
    Text(
        "Documents, spreadsheets, presentations and notebooks, in one place.",
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
        color = Atrium.colors.ink,
    )
    Spacer(Modifier.height(12.dp))
    Text(
        "An open-source office suite. Your files live in your own Atrium drive.",
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        color = Atrium.colors.ink2,
    )
    Spacer(Modifier.height(24.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        for (k in listOf(Kind.DOC, Kind.SHEET, Kind.SLIDES, Kind.NOTEBOOK, Kind.FOLDER)) KindTile(k, size = 44.dp)
    }
    Spacer(Modifier.height(32.dp))
    Button(onClick = onLogin, enabled = !auth.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Sign in") }
    Spacer(Modifier.height(10.dp))
    OutlinedButton(onClick = onSignup, enabled = !auth.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Create account") }
    Spacer(Modifier.height(10.dp))
    TextButton(onClick = onGuest, enabled = !auth.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) {
        if (auth.busy) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Spacer(Modifier.size(10.dp))
        }
        Text("Try it without an account")
    }
    auth.error?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = Atrium.colors.danger, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
    Spacer(Modifier.height(24.dp))
    Text(server.substringAfter("://"), style = MaterialTheme.typography.labelSmall, color = Atrium.colors.muted)
}

@Composable
private fun AuthForm(
    signup: Boolean,
    auth: AuthState,
    onBack: () -> Unit,
    onLogin: (String, String) -> Unit,
    onSignup: (String, String, String) -> Unit,
    onSwitch: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val submit = { if (signup) onSignup(name, email, password) else onLogin(email, password) }

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back", tint = Atrium.colors.ink2) }
    }
    Logo()
    Spacer(Modifier.height(20.dp))
    Text(if (signup) "Create your account" else "Sign in to Atrium", style = MaterialTheme.typography.titleLarge, color = Atrium.colors.ink)
    Spacer(Modifier.height(20.dp))
    if (signup) {
        OutlinedTextField(
            value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true,
            isError = auth.field == "name",
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
    }
    OutlinedTextField(
        value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true,
        isError = auth.field == "email",
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = password, onValueChange = { password = it }, label = { Text("Password") }, singleLine = true,
        isError = auth.field == "password",
        supportingText = if (signup) ({ Text("At least 8 characters") }) else null,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { if (!auth.busy) submit() }),
        modifier = Modifier.fillMaxWidth(),
    )
    auth.error?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = Atrium.colors.danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth())
    }
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = submit,
        enabled = !auth.busy && email.isNotBlank() && password.isNotEmpty() && (!signup || name.isNotBlank()),
        modifier = Modifier.fillMaxWidth().height(48.dp),
    ) {
        if (auth.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else Text(if (signup) "Create account" else "Sign in")
    }
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = onSwitch) {
        Text(if (signup) "Already have an account? Sign in" else "New to Atrium? Create an account")
    }
}
