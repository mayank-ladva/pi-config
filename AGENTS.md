# Pi Global Instructions

- Work step by step.
- For taskflow work, use the current task directory under `tasks/<NNN-slug>/` as the source of truth.
- Do not create a separate `tasks/<name>.md` when a taskflow task is active.
- For lightweight non-taskflow work only, create or update `tasks/<name>.md` before implementation.
- Keep the current task artifact visible and refresh it after compaction or context resets.
- Treat the selected task artifact as the source of truth during compaction.
- Ask clarifying questions when requirements are unclear.
- Prefer small, reversible changes.
- Run safe validation (lint/typecheck/tests) without asking when it fits the change.
- Ask before risky commands, destructive edits, or secret access.
- Keep answers concise unless the user asks for detail.
