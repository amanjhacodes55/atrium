plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// One place to point the app at a self-hosted Atrium: -PatriumBaseUrl=https://… or gradle.properties.
val atriumBaseUrl = (providers.gradleProperty("atriumBaseUrl").orNull ?: "https://atrium-office.netlify.app").trimEnd('/')
val atriumHost = atriumBaseUrl.substringAfter("://").substringBefore('/').substringBefore(':')
val atriumScheme = atriumBaseUrl.substringBefore("://")

android {
    namespace = "org.atrium.app"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "org.atrium.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "1.1.0"

        buildConfigField("String", "BASE_URL", "\"$atriumBaseUrl\"")
        // Lets the manifest's deep-link filters follow the configured server.
        manifestPlaceholders["atriumHost"] = atriumHost
        manifestPlaceholders["atriumScheme"] = atriumScheme
    }

    buildTypes {
        release {
            optimization {
                enable = true
                packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
