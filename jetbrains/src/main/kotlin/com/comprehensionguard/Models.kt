package com.comprehensionguard

enum class Outcome { PASS, BORDERLINE, FAIL }

enum class AttemptOutcome { PASS, FAIL, BYPASS, DISPUTED, EXPLAINED }

data class Criterion(
    val id: String,
    val text: String,
    val critical: Boolean,
    val hint: String? = null,
)

data class Verdict(val id: String, val verdict: String, val evidence: String)

data class Question(
    val question: String,
    val referenceAnswer: String,
    val criteria: List<Criterion>,
)

data class Attempt(
    val timestamp: Long,
    val language: String,
    val charCount: Int,
    val passed: Boolean,
    val outcome: String,
    val question: String,
)

data class MisgradeReport(
    val timestamp: Long,
    val language: String,
    val question: String,
    val studentAnswer: String,
    val feedback: String,
    val snippetPreview: String,
)

data class QuizResult(
    val keep: Boolean,
    val outcome: AttemptOutcome,
    val question: String,
    val answer: String,
    val feedback: String,
)
