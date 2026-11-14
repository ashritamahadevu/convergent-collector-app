package com.comprehensionguard

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.actionSystem.EditorActionHandler
import com.intellij.openapi.editor.actionSystem.EditorActionManager
import com.intellij.openapi.editor.event.BulkAwareDocumentListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.ui.Messages
import java.awt.datatransfer.DataFlavor
import java.util.concurrent.atomic.AtomicBoolean

object QuizSession {
    val writing = AtomicBoolean(false)
    val busy = AtomicBoolean(false)
}

class GuardStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        GuardInstaller.install()
    }
}

private object GuardInstaller {
    private val installed = AtomicBoolean(false)

    fun install() {
        if (!installed.compareAndSet(false, true)) return
        val manager = EditorActionManager.getInstance()
        val original = manager.getActionHandler(IdeActions.ACTION_EDITOR_PASTE)
        manager.setActionHandler(IdeActions.ACTION_EDITOR_PASTE, GuardedPasteHandler(original))
        com.intellij.openapi.editor.EditorFactory.getInstance().eventMulticaster
            .addDocumentListener(GuardDocumentListener(), ApplicationManager.getApplication())
    }
}

private class GuardedPasteHandler(private val original: EditorActionHandler) : EditorActionHandler() {
    override fun doExecute(editor: Editor, caret: com.intellij.openapi.editor.Caret?, dataContext: DataContext) {
        val settings = GuardSettings.get()
        val text = clipboardText()
        if (!settings.enabled() || text.length < settings.threshold() || !QuizSession.busy.compareAndSet(false, true)) {
            original.execute(editor, caret, dataContext)
            return
        }
        try {
            val start = editor.selectionModel.selectionStart
            val end = editor.selectionModel.selectionEnd
            QuizSession.writing.set(true)
            WriteCommandAction.runWriteCommandAction(editor.project) {
                if (end > start) editor.document.deleteString(start, end)
                editor.document.insertString(start, text)
            }
            QuizSession.writing.set(false)
            val keep = ask(editor, text)
            if (!keep) deleteIfUnchanged(editor, start, text)
        } finally {
            QuizSession.busy.set(false)
        }
    }
}

private class GuardDocumentListener : BulkAwareDocumentListener {
    override fun documentChangedNonBulk(event: DocumentEvent) {
        if (QuizSession.writing.get() || QuizSession.busy.get()) return
        val settings = GuardSettings.get()
        if (!settings.enabled()) return
        val added = event.newFragment?.toString() ?: return
        if (added.length < settings.threshold() || event.oldLength > added.length) return
        val editor = com.intellij.openapi.editor.EditorFactory.getInstance().allEditors
            .firstOrNull { it.document == event.document } ?: return
        val start = event.offset
        if (!QuizSession.busy.compareAndSet(false, true)) return
        ApplicationManager.getApplication().invokeLater {
            try {
                val keep = ask(editor, added)
                if (!keep) deleteIfUnchanged(editor, start, added)
            } finally {
                QuizSession.busy.set(false)
            }
        }
    }
}

private fun ask(editor: Editor, snippet: String): Boolean {
    try {
        val settings = GuardSettings.get()
        val language = FileDocumentManager.getInstance().getFile(editor.document)?.fileType?.name ?: ""
        val question = loadQuestion(settings, snippet, language)
        val dialog = QuizDialog(snippet, question)
        dialog.show()
        val result = dialog.result ?: QuizResult(false, AttemptOutcome.FAIL, question?.question ?: "", "", "")
        settings.record(
            Attempt(
                timestamp = System.currentTimeMillis(),
                language = language,
                charCount = snippet.length,
                passed = result.outcome == AttemptOutcome.PASS || result.outcome == AttemptOutcome.DISPUTED,
                outcome = result.outcome.name.lowercase(),
                question = result.question,
            ),
        )
        if (result.outcome == AttemptOutcome.DISPUTED) {
            settings.recordMisgrade(
                MisgradeReport(
                    timestamp = System.currentTimeMillis(),
                    language = language,
                    question = result.question,
                    studentAnswer = result.answer,
                    feedback = result.feedback,
                    snippetPreview = snippet.take(2000),
                ),
            )
        }
        return result.keep
    } catch (_: Exception) {
        return true
    }
}

private fun loadQuestion(settings: GuardSettings, snippet: String, language: String): Question? {
    if (settings.provider() != "ollama" && GuardSettings.apiKey(settings.provider()).isNullOrBlank()) {
        return null
    }
    return try {
        LlmClient(settings.provider(), GuardSettings.apiKey(settings.provider()) ?: "").generate(snippet, language)
    } catch (_: Exception) {
        null
    }
}

private fun deleteIfUnchanged(editor: Editor, start: Int, text: String) {
    val document = editor.document
    val end = start + text.length
    if (end > document.textLength) return
    if (document.text.substring(start, end) != text) return
    QuizSession.writing.set(true)
    try {
        WriteCommandAction.runWriteCommandAction(editor.project) {
            document.deleteString(start, end)
        }
    } finally {
        QuizSession.writing.set(false)
    }
}

private fun clipboardText(): String {
    val contents = java.awt.Toolkit.getDefaultToolkit().systemClipboard.getContents(null) ?: return ""
    return if (contents.isDataFlavorSupported(DataFlavor.stringFlavor)) {
        contents.getTransferData(DataFlavor.stringFlavor) as? String ?: ""
    } else {
        ""
    }
}

class SetApiKeyAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        val provider = GuardSettings.get().provider()
        val key = Messages.showPasswordDialog(project, "API key for $provider", "Comprehension Guard", null) ?: return
        if (key.isBlank()) return
        GuardSettings.setApiKey(provider, key.trim())
        Messages.showInfoMessage(project, "Saved a key for $provider.", "Comprehension Guard")
    }
}
