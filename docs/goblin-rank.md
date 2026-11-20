# Goblin rank

The dashboard goblin has five stats. The stage (peasant, squire, knight, wizard, king) is the result of those stats, not a sixth number. A student starts as a peasant. 100 on every stat is the only way to reach king.

Quiet days do not change anything. A stat moves when they code and a quiz or a follow-up check actually happens.

## Stats

| Stat | What it measures | What does not move it |
|---|---|---|
| Streak | Consecutive coding sessions where they stayed for the check | A day with no coding. It breaks only when a quiz fires and they bypass, close it, or choose "I don't know." |
| IQ | Average concept mastery from the knowledge-tracing model | A weekly pass rate. One easy pass cannot fill the bar, and one miss cannot empty it. |
| Recall | Follow-up checks with the code hidden | A week with no follow-up due |
| Range | How many concepts are above the mastery line (0.75) | A quiz that does not push a concept across that line |
| Grit | Share of recent quizzes they actually answered | A quiet week |

Bypass and "I don't know" keep the code but do not count as knowing it. A disputed grade ("my answer was right") counts as a real pass.

## How 100 is defined

| Stat | 0 | 100 |
|---|---|---|
| IQ | Mastery still at the starting prior (0.2) | Average concept mastery at 0.9 |
| Range | No concept above 0.75 | 8 concepts above 0.75 |
| Recall | No successful follow-up yet | Average chance of remembering a reviewed concept is 0.9 |
| Grit | None of the last 20 quizzes were actually answered | All of the last 20 were answered |
| Streak | No honored session | 10 sessions in a row where they stayed for the check |

Until they have had two follow-up checks, Recall is treated as 50, not 0, so a new student is not stuck at peasant for lack of reviews.

Displayed IQ maps mastery `m` with `clamp((m - 0.2) / 0.7, 0, 1) * 100`. Range is `min(concepts above 0.75, 8) / 8 * 100`. Streak is `min(honored sessions in a row, 10) / 10 * 100`.

## Weights

IQ 30, Recall 25, Range 20, Grit 15, Streak 10.

Understanding that lasts is 75 of the score. Showing up and not skipping is 25.

## Stages

A stage requires every floor, not just the weighted total.

| Stage | IQ | Range | Recall | Grit | Streak | Total |
|---|---|---|---|---|---|---|
| Peasant | — | — | — | — | — | start |
| Squire | 35 | — | — | 50 | 20 (2 sessions) | 30 |
| Knight | 55 | 38 (3 concepts) | 45, and at least 2 follow-ups | 65 | 40 (4 sessions) | 50 |
| Wizard | 70 | 63 (5 concepts) | 70 | 80 | 60 (6 sessions) | 70 |
| King | 90 | 88 (7 concepts) | 85 | 90 | 80 (8 sessions) | 90 |

Squire means they answer the check when they code. Knight is the first stage that requires follow-up memory and a few real concepts. Wizard requires those to be broad and stable. King requires all five near the top.

A stage drops only if a floor stays missed across two weekly snapshots. One bad session does not demote them. A quiet week does not demote them.
