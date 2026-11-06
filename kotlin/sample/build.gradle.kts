// App d'exemple Android : l'App membre de test `demo-android`, branchée sur le `docker compose` local.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

/** Réglable par `-Plive.xxx=…` ou dans `~/.gradle/gradle.properties`. */
fun liveProperty(name: String, default: String): String =
    providers.gradleProperty("live.$name").getOrElse(default)

android {
    namespace = "fr.echimine.live.sample"
    compileSdk = 36

    defaultConfig {
        applicationId = "fr.echimine.live.sample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // 10.0.2.2 : la machine hôte vue depuis l'émulateur Android.
        buildConfigField("String", "SERVER_URL", "\"${liveProperty("serverUrl", "http://10.0.2.2:3000")}\"")
        buildConfigField("String", "APP_ID", "\"${liveProperty("appId", "demo-android")}\"")
        // Secret factice de server/member-apps.example.json, jamais utilisé en production.
        buildConfigField(
            "String",
            "TOKEN_SECRET",
            "\"${liveProperty("tokenSecret", "secret-factice-demo-android-ne-jamais-utiliser-en-prod")}\"",
        )
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":ui"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
}
