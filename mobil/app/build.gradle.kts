plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.kapanis.mobil"
    compileSdk = 37

    // The Eon 2 app compiles its own bounded product source set. Historical v1
    // Android files remain in src/main/java for audited export and migration.
    sourceSets {
        getByName("main") {
            java.setSrcDirs(listOf("src/eon2/kotlin"))
            kotlin.setSrcDirs(listOf("src/eon2/kotlin"))
        }
    }

    defaultConfig {
        applicationId = "com.kapanis.mobil"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Keep the original Eon Android installation and user data untouched.
            applicationIdSuffix = ".eon2.dev"
            versionNameSuffix = "-eon2"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // AGP 9 manages Kotlin compilation; Java 17 bytecode stays explicit above.
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    // Real backdrop sampling/refraction; 1.x matches our Kotlin 2.3 / Compose toolchain.
    implementation("io.github.kyant0:backdrop:1.0.6")

    testImplementation("junit:junit:4.13.2")
    debugImplementation(libs.androidx.ui.tooling)
}
