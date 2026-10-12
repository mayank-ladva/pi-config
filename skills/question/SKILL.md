---
name: question
description: Generate precise clarifying questions to resolve ambiguity in a request.
---

# /question

Use the full text after `/question` as the input.

## Workflow

1. Parse the request literally (no assumptions yet).
2. Identify missing or ambiguous elements across:
   - objective (what success looks like)
   - scope (what's included/excluded)
   - constraints (tech, performance, deadlines, edge cases)
3. Check available context (repo, files, prior messages) before asking.
4. Ask **1-3 high-signal questions only**:
   - Each must resolve a concrete ambiguity
   - Avoid generic or obvious questions
   - Prefer questions that unblock implementation decisions
5. If ambiguity remains too high, give a minimal example of a well-formed request and stop.

## Output format

Goal:

- Interpreted intent of the request (1 sentence)

Assumptions:

- Key inferred details (only if reasonably confident)

Scope:

- In scope: ...
- Out of scope: ...

Risks / edge cases:

- ...

Open questions:

- Q1: ...
- Q2: ...
- Q3: ...

## Rules

- Do not answer the request itself.
- Do not over-question; max 3 questions.
- Prefer specificity over coverage.
- Avoid repeating what is already clear.
- Keep total output concise and scannable.
