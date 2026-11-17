# Dashboard ↔ memory-model alignment

Notes for aligning the DrawBridge dashboard design with the data the extension
actually produces. Grounded in [memory-system.md](memory-system.md),
[desktop-backend.md](desktop-backend.md), the sync schema in
[src/memory/sync.ts](../src/memory/sync.ts), the types in
[src/types.ts](../src/types.ts), and the tree-sitter analysis in
[src/sizing](../src/sizing).

The short version: **the schema you planned already exists on the extension
side** — the per-concept / per-file / recall / review payloads are built; today
they are queued to Supabase in `src/memory/sync.ts`. We are **dropping Supabase
and the web dashboard**: everything goes to the **local desktop backend**. So
the work is (a) retarget those existing payloads from Supabase to the local
backend, (b) grow the backend schema to receive them, and (c) the taxonomy /
scoring / edge decisions below (now resolved — see §7).

---

## 0. Decision (resolved): local desktop backend is the single source

No Supabase, no web dashboard. Everything is stored locally in the desktop
backend. Today there are two stores and the mockups mix them:

| Store | Code | Holds | Fate |
|---|---|---|---|
| Desktop backend | `desktop/backend`, `src/dashboard` | `checks` only (one row per question) | **Keep and expand** to hold everything |
| Supabase sync | `src/memory/sync.ts` | `concept_mastery`, `recall_cards`, `profiles`, `file_knowledge`, `review_events`, `prep_sets` | **Retire as a transport**; repoint these payloads at the local backend |

Consequence: the extension already knows how to build every table the Map and
Topics screens need (`src/memory/sync.ts` `SyncOp`). The missing pieces are a
**local transport for them** (the dashboard outbox currently only carries
`check.recorded`) and **matching tables + read endpoints** in the backend (§2).

**Transport plan:** extend the outbox + `/v1/events` to accept new event types
(`mastery.updated`, `recall.updated`, `file.updated`, `review.recorded`,
`profile.updated`, `prepset.created`), reusing the same atomic-file outbox,
retry, and quarantine machinery already in `src/dashboard/outbox.ts`. Reshape
`src/memory/sync.ts` to enqueue into that outbox instead of POSTing to Supabase,
so the existing `queueMastery` / `queueCard` / `queueFileKnowledge` /
`queueReview` / `queueProfile` call sites in `src/memory/remember.ts` don't
change.

---

## 1. Concept taxonomy: why 10, and how to get nuance without breaking mastery

Your instinct is right that 10 flags is coarse. But the small set is deliberate,
and the fix is a **second layer**, not a bigger flat list.

### Why the canonical set is small (keep it)
`control-flow`, `data-structures`, `mutation-aliasing`, `async-concurrency`,
`error-handling`, `complexity`, `api-semantics`, `types`, `recursion`, `io`
(from [src/sizing/concepts.ts](../src/sizing/concepts.ts)).

BKT and Elo (`src/memory/bkt.ts`) estimate one mastery probability **per
concept**. They need enough attempts per concept to be stable — the memory doc
calls the tag set a "Q-matrix" and warns that a mis-scoped tag "quietly corrupts
the learner model." 50 fine-grained flags means a handful of attempts each and
noisy, useless mastery. So: **keep ~10 canonical concepts as the mastery
backbone.**

### Add a topic layer for display and grouping (new)
The mockups' "weak points" — *Coalescing free blocks*, *Pointer arithmetic*,
*Segregated free lists* — are **not concepts**. They are project/lab topics.
We already have a natural source: the tree-sitter plan emits a `keyIdea` per
unit ([src/sizing/plan.ts](../src/sizing/plan.ts)) and `file_knowledge` carries
the file path. Propose a two-level model:

- **Concept** (canonical, ~10): drives mastery/Elo/recall. Fixed vocabulary.
- **Topic** (free-form, many): human-readable label from `keyIdea` / symbol /
  file, used only for display, grouping, and the "weak point" cards. No mastery
  math runs on topics; a topic *rolls up* to one or more concepts.

This is how "Coalescing free blocks" (topic) maps to `mutation-aliasing` +
`data-structures` (concepts) for the actual learner model.

### Overlap and nuance
- A single check already tags **multiple** concepts (`check.concepts` is an
  array; `rememberCheck` updates each independently). That is the intended way
  to express overlap — one `coalesce.c` question can be both `control-flow` and
  `mutation-aliasing`.
- Independent per-concept updates ignore correlation (getting recursion right is
  evidence toward control-flow). That is acceptable for now; the memory doc
  explicitly defers correlated/deep models until ~1M interactions.
- **Design ask:** the "Correct % by weak point" bars should state whether a bar
  is a *concept* (stable, ~10, comparable across users) or a *topic* (project-
  specific, not comparable). They are different axes and should not share a list.

---

## 2. Backend / schema: what to add so per-file and per-concept work

The extension already knows how to emit all of this (it is in the `SyncOp`
union in `src/memory/sync.ts`). The desktop backend needs the matching tables
and read endpoints, and the transport is retargeted from Supabase to the local
outbox (§0). Column names below follow the existing types so no payload shape
changes are required.

### 2a. `concept_mastery` (payload exists → add table + endpoint)
Matches `ConceptMastery` in [src/types.ts](../src/types.ts):
`concept, mastery (0..1), elo, attempts, lastSeen`.
Powers: Topics bars, per-file status, "weakest concepts."
Endpoint: `GET /v1/mastery`.

### 2b. `recall_cards` (payload exists → add table + endpoint)
Matches `RecallCard`: `concept, ease, intervalDays, repetitions, dueAt,
stability, difficulty, lastReview`. Retrievability is **computed, not stored**
(`src/memory/scheduler.ts`).
Powers: a **"Due for review today"** panel (currently missing from the design
entirely, and arguably the most actionable learner stat we have).
Endpoint: `GET /v1/recall?due=now`.

### 2c. `file_knowledge` (payload exists → add table + endpoint) — the per-file data you want
Matches `FileKnowledge`: `path, concepts[], passed, aiWritten, core,
complexity, centrality, updatedAt`.
Per-file **understanding %** is **not** a check score — it is
`fileUnderstanding()` in [src/memory/understanding.ts](../src/memory/understanding.ts):
`mean(mastery × recall)` over the file's concepts, bucketed as
**≥0.75 understood / ≥0.35 in-progress / else not-yet** (plus `skipped` for
non-core). The Map's "22% Needs review" should use exactly this, and reuse
these thresholds instead of inventing "Needs review / Strong" cutoffs.
Endpoint: `GET /v1/files`.

### 2d. `review_events` = your "History Log" (payload exists → add table + endpoint)
This is the trends-over-time log. `ReviewEvent` in
[src/memory/remember.ts](../src/memory/remember.ts) already carries concept,
question, answer, misconception, score, pass/fail, source, filePath,
`masteryAfter`, timestamp. **Source code is excluded by design.**
Note this overlaps the desktop backend's current `checks` table — we should pick
one as the history record and not store both. `review_events` is richer
(`masteryAfter`, explicit misconception) and matches your planned "mastery %
after quiz" field, so prefer it.

### 2e. `profiles` and `prep_sets` (payloads exist → add tables + endpoints)
`ProfileFacts` (`examDate, interviewDate, preferredLanguage, strictness`) drives
exam-aware spacing and the "set on Mon Nov 9" goal context. `prep_sets` are the
generated interview/exam questions. Both already sync.

### Privacy invariants to keep in the schema (don't regress)
- No raw source and no embeddings are stored (memory-system.md §2, §7). Even
  though everything is local now, keep source out of the payloads so the backend
  file stays shareable/inspectable.
- File paths are workspace-relative or null; absolute paths are stripped in
  `src/dashboard/service.ts`.
- `review_events` include question/answer text but not full source.

---

## 3. Scoring: /5 vs % vs questions-passed (needs one definition)

Three different scales are conflated in the mockups.

- **Per-question quality score.** `check.score` is `0..1` (or `null`), and the
  backend shows `score × 5`, so the gauge "4/5" = 80% = the weekly goal. For
  free-text it is the passed/applicable criterion ratio; **MCQ/debug/ordering
  are binary** (0 or 1) per [desktop-backend.md](desktop-backend.md), so a
  granular "3/5" only ever happens for free-text.
- **Null scores must render as a state, not 0.** `bypass`, `explained`,
  `ungraded` carry `score === null` and are excluded from the average and the
  completed count. A bypassed paste showing "0/5" is wrong; show a
  "bypassed / not graded" chip.
- **Questions-passed (your idea).** A paste or agent edit spawns **N questions**,
  but today each question is its **own** `checks` row with its own `eventId`.
  There is no "check = the whole edit" grouping yet. To show "passed 3 of 5
  questions" we need a **group id** shared by the questions from one edit, then
  the dashboard aggregates `passed/total` with a **variable denominator**.

**Two different numbers, both legitimate — the design should show both, labeled:**
quality (mean score ×5) and coverage (questions passed / asked). Right now the
gauges imply they are the same thing.

**Code edit needed for grouping:** add a `groupId` (e.g. the agent
`session_id + prompt_id`, or the paste's insertion id) to the emitted event so
follow-up questions from one edit can be rolled up. Follow-ups already get
separate event IDs (desktop-backend.md), so the group id is the missing link.

---

## 4. File-map edges / adjacency: cost, usefulness, accuracy

**We already compute the graph.** `analyzeFiles` in
[src/sizing/analyze.ts](../src/sizing/analyze.ts) fills `calls` and `callers`
per `UnitFact`, and `centrality` is already stored on `file_knowledge`. What is
**not** persisted is the **edge list** (which file links to which).

### Storage cost — small
An edge is two short relative paths (plus optional type/weight). Real repos are
sparse graphs: edges ≈ files × average out-degree (typically 3–10). Even a
2,000-file repo is a few thousand rows / low tens of KB as a `file_edges`
table (`from_path, to_path, kind, weight, updatedAt`). This is negligible next
to `review_events`. Recompute incrementally on file change (content hash), same
as the repo-map plan in memory-system.md §1d.

### Usefulness — high for two features
- The **Map** graph edges (what the design draws).
- **"Linked files" + "Review first" ordering** — walking callees/callers of a
  weak file is a concrete study order, not a vanity graph.

### Accuracy — caveats to design around
- Edges are only found when files are analyzed **in the same batch**; a
  single-file analysis won't see cross-file callers. Needs a repo-wide pass or
  accumulation over time.
- Name-based linking (call name → unit name) misses dynamic dispatch, collides
  on duplicate function names across files, and conflates imports with calls.
- **Recommendation:** store a **directed** edge list with a `kind`
  (`call` / `import`) and treat it as best-effort (show confidence or just
  "related"), not a precise call graph. Good enough for study ordering and the
  map; don't promise correctness.

---

## 5. Concrete change list

### Design should add / change
1. State which backend is the source (§0); label each panel's data source.
2. Split "weak points" into **Concept** bars (≈10, comparable) vs **Topic**
   cards (project-specific); stop mixing them.
3. Rename "Paste #N" → "Check," show `source` (paste / inline / agent / recall /
   walkthrough) as a badge.
4. Add explicit **null-score** state (bypassed / not graded) to gauges and the
   History score column.
5. Show **two** numbers where relevant: quality (score ×5) and coverage
   (questions passed/asked).
6. Map per-file % = `fileUnderstanding` (mastery × recall); reuse the
   0.75 / 0.35 thresholds for buckets.
7. Add a **"Due for review today"** panel from `recall_cards`.
8. "Review this file" deep-links back into the editor — the dashboard cannot
   render source.

### Code edits needed
1. Retire Supabase as a transport: reshape `src/memory/sync.ts` to enqueue into
   the local dashboard outbox instead of POSTing to Supabase, keeping the
   `queueMastery` / `queueCard` / `queueFileKnowledge` / `queueReview` /
   `queueProfile` call sites unchanged. — `src/memory/sync.ts`,
   `src/dashboard/outbox.ts`
2. Dashboard protocol: add event types `mastery.updated`, `recall.updated`,
   `file.updated`, `review.recorded`, `profile.updated`, `prepset.created`
   with validators alongside `isCheckEvent`. — `src/dashboard/protocol.ts`
3. Desktop backend: add tables + read endpoints for `concept_mastery`,
   `recall_cards`, `file_knowledge`, `review_events`, `profiles`, `prep_sets`,
   and accept the new event types on `/v1/events`. — `desktop/backend`
4. History record: make `review_events` the history log (richer: has
   `masteryAfter`, explicit misconception) and fold the current `checks` table
   into it; keep one record type. — `desktop/backend/database.ts`,
   `src/dashboard/protocol.ts`
5. Add a `groupId` to emitted review events so multi-question edits roll up into
   one "check" with a questions-passed denominator. — `src/quiz.ts`,
   `src/agentGuard.ts`, `src/dashboard/protocol.ts`
6. Persist a `file_edges` adjacency list (directed, `kind` call/import) from
   `analyzeFiles` `calls`/`callers`; enqueue it; add `GET /v1/files/edges`. —
   `src/sizing/analyze.ts`, `src/memory/sync.ts`, backend
7. Add a topic field (from `keyIdea`) to emitted events / `file_knowledge` so
   the dashboard can group by topic without overloading concepts. — `src/sizing`,
   `src/memory/remember.ts`
8. Growth endpoint: optional first-try split (`retries === 0`) if the design
   keeps "first-try score." — `desktop/backend/database.ts`

---

## 6. Decisions locked

- **Backend:** local desktop backend only. No Supabase, no web dashboard; the
  Supabase transport is retired and its payloads are repointed at the local
  backend (§0).
- **Taxonomy:** keep ~10 canonical concepts for mastery/Elo/recall, add a
  free-form **topic** layer (from `keyIdea`) for display and the "weak point"
  cards; topics roll up to concepts (§1).
- **Check grouping:** the dashboard unit is the whole edit, showing "passed X of
  Y questions" via a new `groupId` (§3).
- **File edges:** build now — persist `calls`/`callers` as a best-effort
  directed `file_edges` list for the Map and "review first" ordering (§4).

## 7. Still worth your call

- **History record:** confirmed direction is folding `checks` into
  `review_events`. Flag if you'd rather keep the thin `checks` table too.
- **First-try score:** is the Growth headline first-try only (`retries === 0`)
  or all attempts?
- **Edge accuracy:** are we OK labeling map links "related files" (best-effort)
  rather than a precise call graph, given single-file analyses miss cross-file
  callers until a repo-wide pass exists?
