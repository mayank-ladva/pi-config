---
name: git-commit
description: Draft clean conventional commits with single responsibility.
---

# Git commit

1. Inspect repo context first:
   - `git status -sb`
   - `git branch -vv`
   - `git remote -v`
   - `git diff --stat`
   - `git diff --cached --stat` if staged changes exist
   - `git log -5 --oneline`
   - `gh repo view` if available and a remote exists
2. Group the diff by logical purpose; split unrelated changes.
3. Draft one conventional commit per group in `type(scope): message` format.
4. Prefer repo-specific scope names and mention required tests or verification.
5. If a detail is missing, still give a best-effort draft and ask one focused question only after it.
6. Do not stage or commit without approval.
