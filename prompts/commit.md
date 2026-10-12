---
description: Draft conventional commits grouped by single responsibility
argument-hint: [scope]
---

Inspect the repo context before drafting:

1. `git status -sb`
2. `git branch -vv`
3. `git remote -v`
4. `git diff --stat`
5. `git diff --cached --stat` if staged changes exist
6. `git log -5 --oneline`
7. `gh repo view` if `gh` is available and a remote exists
8. look for repo-specific commit conventions in docs or recent commits if helpful

Do not say the remote is unknown until after checking git/gh.
If a detail is still missing, give a best-effort draft first and ask one focused question after it.

Group changes by logical responsibility.
Draft one commit message per group in conventional form: `type(scope): message`.
Prefer repo-specific scope names and keep messages concise, standard, and reviewable.
If branch creation is relevant, suggest a branch name from the diff and base branch.
Call out required tests or verification for each draft.

Do not stage or commit without approval.
