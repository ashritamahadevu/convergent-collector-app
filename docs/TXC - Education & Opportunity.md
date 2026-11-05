**PRODUCT SPEC \- Earned**  
Texas Convergent \| Social Impact \- Education & Opportunity \| F26

**Product Summary:** A VS Code extension that students turn on for themselves when large AI-written code lands in their project whether pasted or from a CLI agent. It pauses until they show they understand it, so AI helps them actually learn instead of letting them skip the learning. Think Opal but for coding with AI.

**SECTION 1 \- PROBLEM  & CONTEXT**  
---

**Problem Statement:**

CS students need a way to use AI coding tools without losing the problem-solving skills that exams and technical interviews test, because pasting or accepting AI-written code takes no effort and gives no signal that they understood it.

* *Why this problem matters:* A lot of classes now allow AI, so this is a learning problem, not a cheating problem. A student can finish a lab (like memory allocator) without understanding it, and the gap only shows up at the exam or the interview. Dr. Chatterjee (UT) called students using AI as a crutch instead of a tool a major problem, and recruiters at the Google workshop stressed hours of hands-on coding because that builds the problem-solving mindset, emphasizing how much value critical thinking and problem-solving mindset hold for a CS major.   
* *Why this is a meaningful opportunity:* AI use is routine, so banning it is not realistic, and nothing sits at the moment AI-written code lands in a project. Focus and screen-time apps show people will choose friction for themselves when it supports a goal; no equivalent exists inside the editor. It applies in classes and outside them (like personal projects), for students, early grads, and developers with personal projects.

**SECTION 2 \- USER RESEARCH**  
---

**User Personas**

Primary User: The self-motivated CS student, who uses the tool by choice to keep their skills sharp.

* *Name/Label:* Skill-conscious Sam, a CS major who uses AI daily.  
* *Age Range/Background:* 18-24, CS or related major, uses AI assistants for labs, assignments, and personal projects. Early grads and developers with personal projects are a close second group.  
* *Goals:* Finish work on time, actually understand the code, and do well on exams, technical interviews, and project deep-dives.  
* *Frustrations:* Reaches for AI to start problems, freezes when asked to explain their own project, and worries about losing skills before exams and interviews.  
* *Behaviors:* Pastes from chat assistants, accepts inline completions, and runs agents such as Claude Code, Cursor, Codex, or Copilot; may already use focus or screen-time apps.  
* *Needs:* Friction that matches their own goals, short and relevant checks, a logged bypass for real deadlines, local-first privacy, and progress they can see.  
* *How they discover our product:* Friends and study groups, student orgs, hackathons, the VS Code Marketplace, and professor or TA recommendations.

Secondary User (if applicable):  Instructors and TAs (optional presets only, no monitoring of students).

* *Name/Label:* Course-staff Chris.  
* *Age Range/Background:* Professor, lecturer, or TA of a programming course that allows AI.  
* *Goals:* Labs that still teach, and students who understand what they submit.  
* *Frustrations:* Cannot stop AI use and does not want to police students; students pass labs but struggle on exams.  
* *Behaviors:* Writes AI policies in syllabi and recommends tools to the class.  
* *Needs:* A recommended setting to hand to students (concepts that matter, minimum depth), with no access to student activity.  
* *How they discover our product:* Student recommendation, departmental channels, and pilots such as a UT course. \[TODO\]

**User Research**

* *Key insights:* Dr. Chatterjee (UT) sees AI as a crutch as a major problem. Google workshop recruiters stressed hours of hands-on coding and depth on projects. AI is allowed in most classes, so the problem is learning, not integrity. Instructor enforcement is a weak first wedge; student-owned use is stronger.  
* *Survey results:* \[TODO\] Planned Google Form: students rank the features by usefulness. Also ask: would you turn this on voluntarily, and when? Which modes would you use (Learn, Interview, Exam prep)? Do you want a leaderboard? Would you use it with friends? Would you choose check length or have it adapt? What would you pay?  
* *Observations:* \[TODO\] Suggested: a one-week trial with 5-10 students, and about 10 professor interviews (would you recommend it, require it, or pay for it?).

**SECTION 3 \- COMPETITIVE ANALYSIS**  
---

**Competitive Landscape**

| Competitor Product | Strengths | Weaknesses |
| :---- | :---- | :---- |
| Intellegode \[Unverified, from team notes\] | Highlight code (AI or not) to get an explanation and a comprehension question; roadmap includes interview prep. | Opt-in per snippet, so it does not stop pasting. |
| Catalyst \[Unverified, from team notes\] | Detects a pasted block, explains it, then quizzes you; closest to this idea. | Appears to act after the paste. \[TODO\] Check whether it holds the code. |
| Devibe \[Unverified, from team notes\] | Detects AI-generated code (hackathon project). | Detection is probabilistic and misses edited output; false positives are costly. |
| Repo-based interview tools: GitReady, Synvex, Greenroom, PracterViews, interview-gen \[small or hackathon projects\] | Generate project-specific interview questions from your repo or resume; some use voice. | Do not know your learning history or which parts you did not understand. |
| Interview prep sites: LeetCode (about \$159/yr), NeetCode Pro (about \$119/yr), AlgoExpert (about \$99-199/yr) \[prices from aggregator sites\] | Large problem banks and established brands. | Generic algorithm practice, not questions about your own projects. |
| AI assistants' learning modes; Copilot Student plan (\$0) \[Unverified\] | Built into tools students already use. | Optional and student-controlled per chat; not tied to what lands in the project. |

**Differentiation**

1\. Acts at the moment AI-written code lands in the editor, and at the commit checkpoint for any AI tool, instead of explaining code after the fact.  
2\. Verifies understanding instead of detecting AI, so there are no false accusations.  
3\. Student-owned, like a focus app: strictness, modes, and a logged bypass are the student's choice.  
4\. Knows what you skipped: which parts were AI-written and which concepts you missed, so Interview and Exam prep target your weak spots instead of generic questions.  
5\. Local-first option (local models) keeps code on the student's machine.  
6\. Community built around the habit: accountability squads (friends on different projects share a streak and weekly goals, with gentle nudges), project squads (teammates on one repo see who has shown understanding of which file and run short walkthroughs), and opt-in leaderboards for consistency, growth, and depth. Squad invites double as referrals. None of the tools in the table above offer a social layer, as far as we found.  
7\. Instructors can recommend presets without monitoring students.  
8\. A learning dashboard, not an activity log: it shows the concepts you've proven and kept (passed a check, then a later recall check), your weak spots, and your progress over time, and it feeds Interview and Exam prep. The tools we found explain code in the moment; none track what you've learned over time \[Unverified\].

**SECTION 4 \- PRODUCT DEFINITION**  
---

**Product Vision/Value Proposition:**

For CS students and early developers who use AI heavily but want to keep their problem-solving skills, this extension pauses large AI-written code until they show they understand it, in the editor and at commit time across AI tools. Unlike tools that explain code on request or detect AI after the fact, it is chosen by the student, tailored to what they skipped, and builds a record of what they actually learned.  
Three modes: Learn (the default and the only one that interrupts; depth adapts from a quick check to a deeper one), Interview (Pro; project deep-dive practice), and Exam prep (Pro; delayed-recall practice on missed concepts).

**Core Use Cases**

Eight use cases, from the paste gate to the optional instructor preset.

Use Case 1: Understand before you keep it (paste)

* *User:* A student in Learn mode.  
* *Goal:* Use AI-written code without skipping the understanding.  
* *Steps:* Pastes (4 or more meaningful lines) or accepts an inline completion. The extension holds the code in memory. The student answers a short Predict, Explain, Change conversation. On a pass the code is inserted; on a miss they get a hint and retry, or log a bypass.  
* *Success:* The student can explain and modify the code, and the concept is logged for later recall.

Use Case 2: Agent-written change (Claude Code, Cursor, Codex, Copilot)

* *User:* A student using an AI agent such as Claude Code, Cursor, Codex, or Copilot.  
* *Goal:* Stay aware of what the agent changed before keeping it.  
* *Steps:* The agent edits files or finishes a run (edit and stop hooks). The extension notes the unreviewed changes and prompts a check on the key changes. A pre-commit or tool hook blocks the commit until the check is passed, or bypassed with a log.  
* *Success:* The student commits only changes they can explain.

Use Case 3: Recall ping

* *User:* Any student with past checks.  
* *Goal:* Keep what they learned, not just pass in the moment.  
* *Steps:* A spaced notification days later asks about a concept from earlier work (for example, coalescing in the malloc lab), with no code shown. A pass pushes the next ping further out; a miss brings a quick refresher and an earlier retry.  
* *Success:* The concept still holds days later and counts toward the North Star.

Use Case 4: Interview practice (Pro)

* *User:* A student or early grad preparing for technical interviews.  
* *Goal:* Explain their own projects in depth under pressure.  
* *Steps:* Starts a timed project deep-dive with a skeptical interviewer persona. Questions target the parts that were AI-written and the concepts they missed.  
* *Success:* Confident, detailed answers about their own code, and fewer weak spots over time.

Use Case 5: Exam prep (Pro)

* *User:* A student with an upcoming exam.  
* *Goal:* Review the concepts they actually struggled with.  
* *Steps:* Enters the exam date. The extension builds practice from missed concepts, with spacing that tightens as the date gets closer.  
* *Success:* Missed concepts pass a recall check before the exam.

Use Case 6: Accountability squad

* *User:* Two to four friends, often on different projects.  
* *Goal:* Stay consistent through shared commitment.  
* *Steps:* Create a squad and invite friends. The squad shares a streak and a weekly goal, with gentle nudges when someone is quiet and opt-in squad leaderboards for consistency, growth, and depth.  
* *Success:* Squad members keep the extension on and meet their weekly goals.

Use Case 7: Project squad

* *User:* Teammates working on the same repo.  
* *Goal:* Make sure someone on the team understands every part of the code.  
* *Steps:* Connect the shared repo. The file knowledge map shows who has shown understanding of which file; teammates run short walkthroughs of files nobody understands yet.  
* *Success:* No file in the repo is left that nobody can explain.

Use Case 8: Instructor preset (optional)

* *User:* An instructor or TA.  
* *Goal:* Recommend a setup that fits the course.  
* *Steps:* Shares a preset with the concepts that matter and a minimum depth. Students choose to apply it; no student activity is shared with staff.  
* *Success:* Students in the course adopt the preset, and the checks target the course's concepts.

**Features**

**P0** \- Critical/Must Have

* Large-insertion detection: flag pastes and inline completions of 4 or more meaningful lines (configurable; ignores blank lines, comments, imports, braces, formatters, git operations, and undo). \[Spike: confirm VS Code paste and document-change APIs.\]  
* Hold until understanding (Learn mode): keep the code in memory and ask a free-response Predict, Explain, Change check; depth adapts to the answer.  
* Grading: rubric-first LLM grading, with checks grounded in running the code where possible; hints and 'not yet' instead of a bare fail.  
* Release on pass: insert the original snippet once the check is passed.  
* Commit checkpoint: a git pre-commit hook that works for every tool (ChatGPT paste, Claude Code, Cursor, Codex, Copilot), with a logged bypass.  
* Local session log: every check is stored on the student's machine and tagged with a concept.

**P1** \- High Priority/Should Have

* Strictness levels: nudge, pause, hold, hard hold (Learn mode only).  
* Claude Code adapter: hooks on file edits, on git commit (deny until a check is passed), and on finish. Confirmed in the Claude Code docs.  
* Cursor adapter: hooks on shell commands, file edits, and stop. Confirmed in the Cursor docs; cloud agents support only some hooks.  
* Codex adapter: hooks before tool use (shell and file edits) and on stop. Confirmed in the Codex docs; project hooks must be trusted by the student.  
* Recall pings: spaced notifications asking about past concepts, capped at one or two a day, with quiet hours and snooze.  
* Dashboard (VS Code webview): what you have learned, concepts, trends, and recall results.  
* Model options: cloud APIs and local models (Ollama).

**P2** \- Medium Priority/Could Have

* Interview mode (Pro): project deep-dive practice with a skeptical interviewer persona, built from your code and your missed concepts; timed.  
* Exam prep mode (Pro): practice from missed concepts with spacing that tightens before the exam date.  
* Accountability squads: shared streak, weekly goal, and gentle nudges for friends on different projects.  
* Squad leaderboards: consistency, growth, and depth boards; opt-in, private by default, weekly resets.  
* Web dashboard with longer history.  
* Copilot adapter: Copilot hooks are in preview and their deny format is unconfirmed; run a spike first.  
* Per-run diff sampling for agents: check the key changes, not every line.

**P3** \- Low Priority/Nice to Have

* Project squads: shared-repo file knowledge map (who has shown understanding of which file) and teammate walkthroughs.  
* Instructor presets: recommended concepts and a minimum depth, with no monitoring.  
* Shareable understanding receipts and an opt-in public profile.  
* Peer mock interviews with AI-generated questions, campus and club boards, and optional email or phone push.  
* Confused-junior persona and translating code to a familiar language.

**Metrics**

Success is learning that lasts, not activity: understanding that still holds days later.

**North Star Metric** (the key measure that captures the core value a product delivers to its customers. This is the indicator of long term success)

* Concepts a student demonstrably understands per week: they passed the check, then passed a later recall check with no assistant.

**Other Success Metrics**

* Time to first completed check (activation).  
* First- and second-try pass rates on checks.  
* Recall retention on spaced pings.  
* Weekly active students and the share still active after week four.  
* Squads formed and the share of students who invite a friend.  
* Free-to-Pro conversion \[TODO: set a target after the pilot\].  
* Courses where an instructor recommends a preset.

**Guardrail Metrics**

* Bypass rate, and whether it falls over time.  
* Median seconds of friction added per check.  
* False-trigger rate (formatters, git operations, moving your own code).  
* Agreement between the AI grader and a human reviewer.  
* Share of students who disable the extension in week one.  
* Notification fatigue: snoozes and mutes of recall pings.  
* LLM cost per active student per week.

**Business model and pricing (added; hypotheses to test)**  
Free: Learn mode, recall pings, a basic dashboard, and accountability squads (social features drive growth).  
Pro: Interview mode, Exam prep mode, deeper history and analytics, and higher use of premium models.  
Price hypotheses (to test, not validated): students about \$5-8 per month or \$40-60 per year with .edu verification; early grads and developers about \$10-12 per month or \$79-99 per year; a season pass around recruiting periods; no lifetime plan because LLM costs recur.  
Price anchors (aggregator sites, verify): LeetCode Premium \$35 per month or \$159 per year, NeetCode Pro \$119 per year, AlgoExpert about \$99-199 per year, Copilot Student plan \$0.  
Go to market: campus CS orgs, hackathons, professor and TA recommendations, and squad invites as referrals. Upsell after about 10 Learn sessions or when a student opens Interview mode. Institutional licenses for course presets and analytics are a later option, not the first buyer.  
Privacy: data stays on the student's machine by default, sharing is opt-in, and it is never sold.  
**Open questions and spikes (added)**  
1\. Does VS Code expose paste interception (DocumentPasteEditProvider) and any signal for who made a change?  
2\. How reliably can a file watcher catch agent edits?  
3\. Can Claude Code, Cursor, and Codex hooks deny git commit until a check passes, and how long may a hook wait?  
4\. What do Copilot hooks expose?  
5\. Is rubric-first LLM grading consistent with human graders, and can it be beaten with another AI chat?  
6\. What question depth keeps students from disabling the tool?  
7\. Will students use squads and leaderboards?  
8\. Would a professor recommend or pay for it?

**SECTION 5 \- UI/UX DESIGN**  
---

**Design System**

* *Mood/tone/aesthetic:*   
* *Colors/hex-codes:*  
* *Typography:*

**User Flow & Figma**

* *Core screens (list the 4–6 most important):*  
* *User flow diagram: \[Insert Diagrams\]*  
* *Low-fidelity wireframes: \[Embed Figma\]*  
* *High-fidelity mockups: \[Embed Figma\]*

**SECTION 6 \- TECHNICAL ARCHITECTURE**

---

**Tech Stack**

* *Frontend: NextJs*  
* *Backend: NodeJS*  
* *Database: Supabase*  
* *Hosting/Deployment: Vercel*

**APIs & Third-Party Services**

* *Gemini/Open AI/Ollama\]: Providing questions and scoring the answers for free response*  
* *\[Service\]: purpose in the product*  
* *…*


