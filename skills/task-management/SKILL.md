---
name: task-management
description: Keep `tasks/` markdown files current and compaction-safe.
---

# Task management

1. If a taskflow task is active, use its `tasks/<NNN-slug>/` directory (`spec.md`, `plan.md`, `tasks.md`, and `state.json`) as the source of truth.
2. Do not create a parallel `tasks/<name>.md` file for taskflow work.
3. For lightweight non-taskflow work only, store the active task in `tasks/<name>.md`.
4. Track goal, context, assumptions, plan, checklist, risks, acceptance, and notes in the selected task artifact.
5. Update the selected task artifact as the work changes.
6. Use it as the source of truth after compaction.
