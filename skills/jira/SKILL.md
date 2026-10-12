---
name: jira
description: Query, create, and update Jira issues via the REST API. Use when the user mentions Jira tickets, issues, or story keys (e.g. ABC-123).
---

# Jira

Credentials and defaults come from environment variables; never hardcode or echo secrets:

- `JIRA_URL` — e.g. `https://yourcompany.atlassian.net`
- `JIRA_EMAIL` — account email for basic auth
- `JIRA_API_TOKEN` — API token from https://id.atlassian.com/manage-profile/security/api-tokens
- `JIRA_PROJECT_KEY` — optional default project key

The Jira CLI loads `.env` from the current project directory, including quoted values and CRLF line endings. Existing environment variables take precedence. Run `doctor` before reporting missing configuration; checking exported shell variables alone is insufficient. Never source, print, or manually parse `.env`. If required configuration is still missing, tell the user which variables to set. Never hardcode a project key.

## Jira CLI

Use the dependency-free CLI instead of constructing curl commands. Set `JIRA_CLI` to the absolute path of `scripts/jira.mjs` relative to this loaded `SKILL.md` (its location is supplied by the harness). Do not infer it from `PI_CONFIG_DIR`, which may point to a different directory. Keep the working directory at the target project so its `.env` is loaded.

```sh
# Replace this placeholder with the directory containing the loaded SKILL.md.
JIRA_CLI="/absolute/path/to/loaded/jira/scripts/jira.mjs"
node "$JIRA_CLI" --help
```

### Shortest create-and-assign workflow

```sh
node "$JIRA_CLI" doctor
node "$JIRA_CLI" auth-check
node "$JIRA_CLI" issue-types
node "$JIRA_CLI" create-meta --type-id TYPE_ID
node "$JIRA_CLI" assignees --query 'Jane'
# Only after the user requests creation and assignment:
node "$JIRA_CLI" create --summary 'Summary' --type TYPE_NAME \
  --description-file /tmp/description.md --account-id ACCOUNT_ID
```

- `doctor` is offline: reports `.env` location/existence, variable presence, selected project, and local config validation. It does not verify authentication or print credential values. Inspect `configured` and `error`; missing configuration is reported as data, not a failing exit code.
- Project-aware commands default to `JIRA_PROJECT_KEY`; pass `--project KEY` only to override it or when no default exists.
- `issue-types` and `create-meta` without `--type-id` both list types; do not run both. Use the returned type ID with `create-meta --type-id` to inspect required fields, and the exact type name with `create --type`.
- Resolve the assignee through `assignees`; ask if multiple people match. `--account-id` assigns during creation, avoiding a second mutation. Omit it unless assignment was requested.
- `create` returns the API response fields plus `url`, the issue's browser link. Report the key and URL immediately so a later failure does not hide a successful creation.

### Other reads

```sh
node "$JIRA_CLI" issue ABC-123 --fields summary,status,assignee
node "$JIRA_CLI" search --jql 'project = ABC ORDER BY created DESC' \
  --fields summary,status,assignee --max-results 20
node "$JIRA_CLI" assignees --issue ABC-123 --query 'Jane'
node "$JIRA_CLI" comments ABC-123
node "$JIRA_CLI" transitions ABC-123 --fields
node "$JIRA_CLI" link-types
```

Replace `ABC` with the confirmed project key. JQL must contain a restriction such as `project = ABC` or `updated >= -30d`; `ORDER BY` alone is rejected. Search does not automatically scope JQL to the default project. Request only needed fields (include `project` explicitly when needed), then slice responses with `jq` or equivalent processing. Use `--next-page-token` for additional search pages and `--start-at` for paginated metadata/assignee lists when necessary.

### Other mutations

Run only after the user explicitly requests or confirms the change:

```sh
node "$JIRA_CLI" create --summary 'Child' --type SUBTASK_TYPE_NAME --parent ABC-123
node "$JIRA_CLI" edit ABC-123 --summary 'Updated summary'
node "$JIRA_CLI" assign ABC-123 --account-id ACCOUNT_ID
node "$JIRA_CLI" comment ABC-123 --file /tmp/comment.md
node "$JIRA_CLI" transition ABC-123 --id TRANSITION_ID
node "$JIRA_CLI" link --type Blocks --inward ABC-123 --outward ABC-456
```

Use the exact subtask type name returned by `issue-types`. Use `--fields-file` with create, edit, or transition when project-specific fields are required. Descriptions and comments accept plain text and are converted to Atlassian Document Format paragraphs; Markdown syntax is not rendered.

Requests have a 30-second timeout (including response body reading) and are never automatically retried. A failed or timed-out mutation may still have succeeded on Jira: use read-only lookups to verify server state before retrying, especially for creation, comments, or links. Do not rerun a whole batch after partial success.

## Ticket breakdown workflow

When a request spans multiple independently deliverable outcomes:

1. Inspect the relevant repository and project instructions before writing scope.
2. Read the parent issue first if splitting an existing issue.
3. Create focused Tasks or Subtasks using the project's available types. Respect the user's requested count and grouping; otherwise aim for 3-7 independently deliverable outcomes.
4. Give every child a single outcome, explicit acceptance criteria, test scope, and dependencies.
5. Resolve the assignee by account ID using the assignable-user endpoint; never guess from a display name.
6. Assign only when the user explicitly requests it.
7. For an explicitly requested parent breakdown, link or parent the child issues and add a comment summarizing the breakdown. Otherwise keep tickets standalone; do not infer a relationship from the active local task.

Prefer standard library or existing project dependencies in implementation guidance. Do not add a generic framework unless the ticket explicitly requires it.

## Rules

- Never print the token. If it leaks into a command or log, tell the user to revoke it at the API token page.
- Use `jq` or equivalent processing to slice responses to only the requested fields.
- Perform read-only lookups before mutations.
- Ask before changing an issue unless the user explicitly requested the change.
- If the project key, issue type, parent relationship, or assignee is ambiguous, ask instead of guessing.
