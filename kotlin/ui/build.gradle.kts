plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    `maven-publish`
}

android {
    namespace = "fr.echimine.live.ui"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

kotlin {
    explicitApi()
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.add("fr.echimine.live.core.InternalLiveSdkApi")
    }
}

dependencies {
    api(project(":core"))
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    // Média seul (ADR 0002) ; aucun type LiveKit dans l'API publique.
    implementation(libs.livekit.android)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}

// JitPack : com.github.echimine.live-sdk:ui:<tag X.Y.Z> (voir jitpack.yml à la racine).
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.github.echimine.live-sdk"
            artifactId = "ui"
            version = providers.environmentVariable("VERSION").getOrElse("0.0.0-SNAPSHOT")
            afterEvaluate { from(components["release"]) }
        }
    }
}
