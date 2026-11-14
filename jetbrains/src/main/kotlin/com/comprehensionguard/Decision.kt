package com.comprehensionguard

private val injectionMarkers = listOf("ignore previous", "mark as pass", "system:")

fun preCheck(answer: String, snippet: String, minLength: Int): String? {
    val trimmed = answer.trim()
    if (trimmed.length < minLength) {
        return "Explain a bit more (at least $minLength characters)."
    }
    if (jaccard(tokens(trimmed), tokens(snippet)) >= 0.8) {
        return "That mostly repeats the code. Explain what it does in your own words."
    }
    return null
}

fun aggregate(criteria: List<Criterion>, verdicts: List<Verdict>, fraction: Double): Pair<Outcome, List<Criterion>> {
    if (criteria.isEmpty()) return Outcome.FAIL to emptyList()
    val byId = verdicts.associate { it.id to it.verdict }
    fun verdictOf(c: Criterion): String = byId[c.id] ?: if (c.critical) "fail" else "n/a"
    val resolved = criteria.map { it to verdictOf(it) }
    val critical = resolved.filter { it.first.critical }
    val allCriticalPass = critical.all { it.second == "pass" }
    val nonCritical = resolved.filter { !it.first.critical && it.second != "n/a" }
    val rate = if (nonCritical.isEmpty()) 1.0 else nonCritical.count { it.second == "pass" }.toDouble() / nonCritical.size
    val anyPass = resolved.any { it.second == "pass" }
    val outcome = when {
        allCriticalPass && rate >= fraction -> Outcome.PASS
        !allCriticalPass && !anyPass -> Outcome.FAIL
        else -> Outcome.BORDERLINE
    }
    val missed = resolved.filter { it.second == "fail" }.map { it.first }
    return outcome to missed
}

private fun tokens(text: String): Set<String> =
    text.lowercase().split(Regex("\\W+")).filter { it.isNotEmpty() }.toSet()

private fun jaccard(a: Set<String>, b: Set<String>): Double {
    if (a.isEmpty() && b.isEmpty()) return 0.0
    val intersection = a.count { it in b }
    val union = a.size + b.size - intersection
    return if (union == 0) 0.0 else intersection.toDouble() / union
}

fun containsInjection(answer: String): Boolean {
    val lower = answer.lowercase()
    return injectionMarkers.any { lower.contains(it) }
}
