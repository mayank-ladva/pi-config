---
description: Create or refresh a compact task markdown file
argument-hint: <task-name>
---

Create or update `tasks/$1.md` first.
If this is task intake, honor the chosen mode from `/task-new`:
- normal: keep the spec lightweight and the plan generic
- tdd: include test cases as `input -> expect` pairs
- grill-me: ask short batches until confident
`/task-new` always prompts for the name after mode selection, shows a spec/plan summary first, and waits for approval before creating the spec and plan files.
Use a markdown checklist and keep it compaction-safe.
Include: goal, context, assumptions, plan, checklist, risks, acceptance, validation, and notes.
Pause before code changes until the task file is approved.
