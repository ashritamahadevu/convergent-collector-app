# Comprehension Guard for IntelliJ and PyCharm

The same plugin loads in IntelliJ IDEA and PyCharm. A large paste or insertion stays in the editor while a quiz is open. Pass keeps it. Closing the dialog or failing the last try removes it. Bypass and "I don't know" keep it and are not counted as correct.

This is the core gate only. Memory, recall, and coding-agent hooks stay in the VS Code extension.

## Run

Requires JDK 21. This project does not compile on JDK 25. If `java -version` is 25, point Gradle at a JDK 21, for example the JetBrains runtime:

```powershell
$env:JAVA_HOME = "C:\Program Files\JetBrains\IntelliJ IDEA 2025.2.5\jbr"
```

```powershell
cd jetbrains
.\gradlew.bat runIde
```

In the sandbox IDE, open a file and paste more than 200 characters. The quiz dialog opens in front of the editor.

## Model

Settings are stored in the IDE. The default provider is OpenAI (`gpt-4o`). Change it by editing the `provider` value in the saved `comprehensionGuard.xml` (`openai`, `gemini`, or `ollama`).

Run **Comprehension Guard: Set API Key** for OpenAI or Gemini. Ollama uses `qwen2.5-coder:7b` at `http://127.0.0.1:11434` and does not need a key. If generation fails, the dialog falls back to "What does this code do?" and accepts an answer of at least 15 characters.
