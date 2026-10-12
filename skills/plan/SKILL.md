---
name: plan
description: Generic /plan helper that asks for missing context, then returns a short actionable plan.
---

# Generic /plan

Use the full text after `/plan` as the request.

## Workflow

1. Read the request literally.
2. If it is empty or too vague, ask 1-3 short clarifying questions focused on:
   - goal
   - scope
   - constraints / edge cases
3. If the request is still unclear after that, give a brief usage example and stop.
4. If it is clear enough, gather only the minimum extra context needed before planning:
   - inspect the relevant files, docs, or nearby code if a workspace is present
   - check existing patterns, tests, and constraints
   - do not rely on taskflow, task files, or repository-specific planning state
5. Make sure you can restate the goal and scope confidently before drafting the plan.
6. Return a plain-text draft plan only. Do not WRITE files or make changes. Keep it short, readable, and actionable.
7. Ensure to give atleast one question to clarify the request to avoid ambiguity even if the request seems clear.

## Output rules

- Do not write files.
- Keep it short, readable, and actionable.
- Use this template:

Goal:

- ...

Assumptions:

- ...

Scope:

- In scope: ...
- Out of scope: ...

Plan:

1. ...
2. ...
3. ...

Risks / edge cases:

- ...

Open questions:

- ...
