package com.comprehensionguard

import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.Action
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

class QuizDialog(
    private val snippet: String,
    private val question: Question?,
) : DialogWrapper(true) {
    private val answer = JBTextArea(6, 48)
    private val feedback = JLabel(" ")
    private val dispute = JButton("My answer was right")
    private var followups = 0
    private var lastFeedback = ""
    var result: QuizResult? = null

    init {
        title = "Comprehension check"
        setOKButtonText("Submit")
        setCancelButtonText("Close")
        init()
        dispute.isVisible = false
        dispute.addActionListener {
            finish(AttemptOutcome.DISPUTED, keep = true)
        }
    }

    override fun createCenterPanel(): JComponent {
        val code = JBTextArea(snippet.take(4000))
        code.isEditable = false
        code.lineWrap = false
        val panel = JPanel(BorderLayout(0, 8))
        panel.preferredSize = Dimension(640, 420)
        panel.border = JBUI.Borders.empty(8)
        panel.add(JBScrollPane(code), BorderLayout.NORTH)
        val center = JPanel(BorderLayout(0, 8))
        center.add(JLabel("<html>${html(question?.question ?: "What does this code do?")}</html>"), BorderLayout.NORTH)
        center.add(JBScrollPane(answer), BorderLayout.CENTER)
        val south = JPanel(BorderLayout())
        south.add(feedback, BorderLayout.CENTER)
        south.add(dispute, BorderLayout.EAST)
        center.add(south, BorderLayout.SOUTH)
        panel.add(center, BorderLayout.CENTER)
        return panel
    }

    override fun createLeftSideActions(): Array<Action> {
        return arrayOf(bypassAction(), explainAction())
    }

    override fun doOKAction() {
        val text = answer.text ?: ""
        if (question == null) {
            val problem = preCheck(text, snippet, 15)
            if (problem != null) {
                showMiss(problem, allowDispute = false)
                return
            }
            finish(AttemptOutcome.PASS, keep = true)
            return
        }
        val problem = preCheck(text, snippet, 15)
        if (problem != null) {
            showMiss(problem, allowDispute = false)
            return
        }
        val verdicts = try {
            LlmClient(GuardSettings.get().provider(), GuardSettings.apiKey(GuardSettings.get().provider()) ?: "").judge(snippet, question, text)
        } catch (err: Exception) {
            finish(AttemptOutcome.PASS, keep = true)
            return
        }
        val (outcome, missed) = aggregate(verdictsLet = verdicts, criteria = question.criteria)
        if (outcome == Outcome.PASS) {
            finish(AttemptOutcome.PASS, keep = true)
            return
        }
        followups += 1
        if (followups < 3) {
            val hint = missed.firstOrNull()?.hint ?: "Look at the part of the code the question asks about and describe what it does."
            showMiss(hint, allowDispute = true)
            return
        }
        finish(AttemptOutcome.FAIL, keep = false)
    }

    override fun doCancelAction() {
        if (result == null) {
            result = QuizResult(false, AttemptOutcome.FAIL, question?.question ?: "", answer.text ?: "", lastFeedback)
        }
        super.doCancelAction()
    }

    private fun showMiss(message: String, allowDispute: Boolean) {
        lastFeedback = message
        feedback.text = message
        dispute.isVisible = allowDispute
    }

    private fun finish(outcome: AttemptOutcome, keep: Boolean) {
        result = QuizResult(
            keep = keep,
            outcome = outcome,
            question = question?.question ?: "What does this code do?",
            answer = answer.text ?: "",
            feedback = lastFeedback,
        )
        close(OK_EXIT_CODE)
    }

    private fun bypassAction(): Action {
        return object : DialogWrapperAction("Bypass") {
            override fun doAction(e: java.awt.event.ActionEvent?) {
                finish(AttemptOutcome.BYPASS, keep = true)
            }
        }
    }

    private fun explainAction(): Action {
        return object : DialogWrapperAction("I don't know, explain it") {
            override fun doAction(e: java.awt.event.ActionEvent?) {
                val explanation = question?.referenceAnswer?.takeIf { it.isNotBlank() }
                    ?: "No model explanation is available for this check."
                Messages.showInfoMessage(explanation, "Comprehension Guard")
                finish(AttemptOutcome.EXPLAINED, keep = true)
            }
        }
    }
}

private fun aggregate(verdictsLet: List<Verdict>, criteria: List<Criterion>): Pair<Outcome, List<Criterion>> =
    aggregate(criteria, verdictsLet, 0.5)

private fun html(text: String): String =
    text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
