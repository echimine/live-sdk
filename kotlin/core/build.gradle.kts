plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    `maven-publish`
}

android {
    namespace = "fr.echimine.live.core"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }

    testOptions {
        unitTests.all {
            // Les fixtures du contrat sont lues là où elles vivent, sans copie (Seam 2).
            it.systemProperty("live.fixtures", rootProject.file("../protocol/fixtures").absolutePath)
        }
    }
}

kotlin {
    explicitApi()
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(libs.coroutines.core)
    api(libs.serialization.json)
    implementation(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}

// JitPack : com.github.echimine.live-sdk:core:<tag X.Y.Z> (voir jitpack.yml à la racine).
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.github.echimine.live-sdk"
            artifactId = "core"
            version = providers.environmentVariable("VERSION").getOrElse("0.0.0-SNAPSHOT")
            afterEvaluate { from(components["release"]) }
        }
    }
}
