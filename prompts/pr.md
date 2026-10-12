---
description: Draft a review-ready pull request summary
argument-hint: [scope]
---

Inspect the repo context before drafting:

1. `git status -sb`
2. `git branch -vv`
3. `git remote -v`
4. `git diff --stat`
5. `git diff --cached --stat` if staged changes exist
6. `gh repo view` if `gh` is available and a remote exists
7. search for repo-specific PR templates or guidelines:
   - `.github/PULL_REQUEST_TEMPLATE*`
   - `.github/pull_request_template*`
   - `CONTRIBUTING.md`, `README.md`, or repo docs if needed

Use the repo's PR template if one exists. If none exists, use the `pr-writing` skill.
Do not say the remote is unknown until after checking git/gh.
If a detail is still missing, draft the PR anyway and ask one focused question after it.

Summarize the change, scope, testing, reviewer focus, risks, migrations, and out-of-scope items.
Include the target repo/base branch when discoverable.
Keep it short, standard, and review-ready.
Prefer a final checklist.
