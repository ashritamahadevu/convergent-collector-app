plugins {
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = "com.comprehensionguard"
version = "0.0.1"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("com.google.code.gson:gson:2.11.0")
    intellijPlatform {
        intellijIdeaCommunity("2024.3.5")
        instrumentationTools()
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    pluginConfiguration {
        id = "com.comprehensionguard.jetbrains"
        name = "Comprehension Guard"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "243"
            untilBuild = "261.*"
        }
        description = """
            Pauses a large paste or insertion until you show you understand it.
            Pass keeps the code. Closing the quiz or failing the last try removes it.
        """.trimIndent()
    }
}
