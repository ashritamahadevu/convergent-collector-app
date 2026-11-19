# Benchmarks

Measured on this machine with Claude Code `2.1.316`. Generation and grading use the extension's real prompts and the same restricted Claude CLI flags as the app. Cost is `total_cost_usd` from the CLI. Sizing does not call a model.

A check is the whole set of questions the plan asks, not a single question. A lighter check asks fewer questions about the whole change. A chunked check asks one question per planned function, and each question is shown only that function. Multiple choice and ordering are graded on the machine. A free-text question also pays for a grading call.

The laptop slept during the chunked check. One of those questions timed out at 3 minutes and was run again after wake. The totals below use the successful calls only.

## Whole checks

Same eight-function JavaScript change. Quick plans 6 multiple-choice questions about the whole file. Standard and Deep both plan 8 multiple-choice questions, one per function, because these functions are too small for an explain or debug question.

| Check | Questions | What the model does | Time | Cost |
| --- | ---: | --- | ---: | ---: |
| Lighter, general | 6 | Generate 6 questions about the whole change. Grade locally. | 81.4s | $0.75 |
| Chunked, specific | 8 | Generate 8 questions, each about one function. Grade locally. | 119.6s | $0.74 |
| One specific free-text question | 1 | Generate a predict question for a 12-branch function, then grade one answer. | 22.3s | $0.18 |

Per question inside those checks:

| Check | Question | Time | Cost |
| --- | --- | ---: | ---: |
| General | 1 of 6, whole change | 10.9s | $0.091 |
| General | 2 of 6, whole change | 12.1s | $0.092 |
| General | 3 of 6, whole change | 23.8s | $0.300 |
| General | 4 of 6, whole change | 12.6s | $0.092 |
| General | 5 of 6, whole change | 10.0s | $0.087 |
| General | 6 of 6, whole change | 12.0s | $0.091 |
| Chunk | f0 | 15.7s | $0.096 |
| Chunk | f1 | 11.7s | $0.089 |
| Chunk | f2 | 17.2s | $0.101 |
| Chunk | f3 | 10.9s | $0.088 |
| Chunk | f4 | 23.6s | $0.091 |
| Chunk | f5 | 16.5s | $0.097 |
| Chunk | f6 | 9.5s | $0.084 |
| Chunk | f7 | 14.5s | $0.093 |
| Free-text | Generate the predict question | 12.4s | $0.088 |
| Free-text | Grade one answer | 9.9s | $0.088 |

The chunked check costs about the same money as the general check and takes longer, because it makes two more model calls. The general check is not cheaper per question: question 3 cost $0.30 on its own. Grading did not add model cost for either multiple-choice check.

A free-text check is the expensive shape per question, because the grade is another Claude call. One predict question plus one grade was 22 seconds and $0.18. A chunked check of eight free-text questions would be about eight of those, on the order of 3 minutes and $1.40, before any retries.

## Sizing

Tree-sitter only. Same machine, no model.

| Scenario | Time | Result |
| --- | ---: | --- |
| Small JavaScript file, one branched function | 0.02s | 2 units, 1 standard question |
| Eight branched functions | 0.00s | 8 standard questions |
| 12-branch function, Quick / Standard / Deep | 0.00s | ordering / predict / predict |
| Three files, caller linked to callee | 0.00s | caller calls callee |

## Single calls from the first run

These are one model call each, kept so the per-question cost is visible. Input tokens were about 17,000 and almost all of that was Claude Code's cached system prompt, not the comprehension prompt.

| Area | Scenario | Time | Cost |
| --- | --- | ---: | ---: |
| Question generation | Free-text, small JavaScript function | 9.81s | $0.0716 |
| Question generation | Multiple choice, small Python function | 14.49s | $0.3456 |
| Question generation | Ordering, 12-branch function | 10.06s | $0.0876 |
| Question generation | Debug, small JavaScript function | 29.75s | $0.1205 |
| Grading | Free-text pass, two criteria | 6.23s | $0.0792 |
| Grading | Free-text miss, two criteria | 6.09s | $0.0791 |
