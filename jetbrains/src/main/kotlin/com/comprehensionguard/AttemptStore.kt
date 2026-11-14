package com.comprehensionguard

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service
@State(name = "ComprehensionGuard", storages = [Storage("comprehensionGuard.xml")])
class GuardSettings : PersistentStateComponent<GuardSettings.State> {
    class State {
        var provider: String = "openai"
        var enabled: Boolean = true
        var threshold: Int = 200
        var attempts: MutableList<String> = mutableListOf()
        var misgrades: MutableList<String> = mutableListOf()
    }

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    fun provider(): String = state.provider

    fun enabled(): Boolean = state.enabled

    fun threshold(): Int = state.threshold

    fun setProvider(value: String) {
        state.provider = value
    }

    fun record(attempt: Attempt) {
        state.attempts.add(
            listOf(
                attempt.timestamp.toString(),
                attempt.outcome,
                attempt.passed.toString(),
                attempt.language,
                attempt.charCount.toString(),
                attempt.question.replace("|", "/"),
            ).joinToString("|"),
        )
        if (state.attempts.size > 1000) {
            state.attempts = state.attempts.takeLast(1000).toMutableList()
        }
    }

    fun recordMisgrade(report: MisgradeReport) {
        state.misgrades.add(
            listOf(
                report.timestamp.toString(),
                report.language,
                report.question.replace("|", "/"),
                report.studentAnswer.replace("|", "/").take(500),
                report.feedback.replace("|", "/").take(500),
            ).joinToString("|"),
        )
        if (state.misgrades.size > 200) {
            state.misgrades = state.misgrades.takeLast(200).toMutableList()
        }
    }

    fun passRate(): String {
        val counted = state.attempts.mapNotNull { parseAttempt(it) }
            .filter { it.outcome != "bypass" && it.outcome != "explained" }
        if (counted.isEmpty()) return "no graded attempts"
        val passed = counted.count { it.passed }
        return "$passed/${counted.size} correct"
    }

    private fun parseAttempt(raw: String): Attempt? {
        val parts = raw.split("|")
        if (parts.size < 5) return null
        return Attempt(
            timestamp = parts[0].toLongOrNull() ?: 0L,
            outcome = parts[1],
            passed = parts[2] == "true",
            language = parts[3],
            charCount = parts[4].toIntOrNull() ?: 0,
            question = parts.getOrElse(5) { "" },
        )
    }

    companion object {
        fun get(): GuardSettings = com.intellij.openapi.components.service()

        fun apiKey(provider: String): String? {
            val attrs = CredentialAttributes("Comprehension Guard", provider)
            return PasswordSafe.instance.get(attrs)?.getPasswordAsString()
        }

        fun setApiKey(provider: String, key: String) {
            val attrs = CredentialAttributes("Comprehension Guard", provider)
            PasswordSafe.instance.set(attrs, Credentials(provider, key))
        }
    }
}
