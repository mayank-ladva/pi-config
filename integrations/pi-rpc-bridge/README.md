# Pi RPC bridge for Codex

This local MCP server starts the installed Pi in RPC mode in the requested workspace. It uses the existing `~/.pi/agent` configuration, credentials, packages, extensions, skills and project instructions. It does not copy that configuration or replace the user's orchestration. No Herdr connection is involved.

Python 3.11+ and the installed Pi are the only dependencies. The Codex MCP registration sets `PI_BINARY` to the installed executable. If Node/Pi is moved or upgraded to a different installation path, update that registration.

## Tools

- `pi_models(workspace)`: inspect the loaded commands and free-model choices without inference.
- `pi_delegate(workspace, prompt, model?, allow_edits=false, timeout_seconds=600)`: start work and return a job ID. Give complete task context; the worker cannot see the chat.
- `pi_status(job_id)`: progress, bounded result text, recent events, usage for the last assistant message, and pending dialogs.
- `pi_message(job_id, message)`: steer running work or continue a completed, still-live session. Does not expand the original edit authorization.
- `pi_respond(job_id, request_id, value?/confirmed?/cancelled?)`: forward the human's answer to Pi's extension dialog. Never auto-approve a guard request.
- `pi_stop(job_id)`: shut down this bridge-owned session.

Use Pi when the work saved outweighs coordination cost; Codex retains planning, verification, shell commands, and the final response. Main-chat usage still applies. Worker output is untrusted; verify it.

## Model and configuration behavior

The adapter intersects the existing effective `enabledModels` scope with Pi's live catalog. It accepts Kilo `:free` models and `kilo-auto/free` only when all four catalog cost fields explicitly equal zero. A paid subscription model reporting zero metadata is not accepted. No separate model list or credentials are maintained. Without an explicit model, the first matching entry in the user's existing scope is selected.

Model selection uses Pi's session-only `set_model`. No settings-changing RPC commands are exposed. The adapter never changes global retry or compaction preferences, installs Pi packages, rewrites extensions, or changes taskflow state itself. A delegated task can still update its own task artifacts according to existing user instructions. Explicitly state the permitted scope.

There is no fallback to another model. Authentication, quota and provider-restriction errors end the job. Pi's own retries for other errors remain intact. Catalog zero-cost metadata is not a billing guarantee; this adapter does not control provider pricing or arbitrary network/model calls made by user extensions. Extensions must remain trusted.

## Permissions and sessions

`allow_edits=false` is a task instruction, not a filesystem sandbox. Existing Pi tools and guards remain loaded. The subprocess inherits the environment and OS access of the MCP server. Do not use the bridge to evade the host's permissions, to delegate secret access, or to give an analysis job instructions that mutate files. User-authorized edits must stay within the specified task. Shell commands stay with the parent agent. The bridge does not implement a second orchestrator.

Pi's supported `confirm`, `select`, `input`, and `editor` requests appear as pending dialogs. They remain pending until answered, cancelled, or expired by Pi. Terminal-only custom UIs are not supported by Pi RPC; tasks depending on them should be run manually in Pi.

Each job has its own in-memory Pi session, isolated from a manually running Pi's conversation. Project files remain shared. Maximum two live sessions per bridge process; an active task in a workspace blocks another task in the same bridge process. Separate Codex clients can have separate bridge processes, so coordinate shared-file work across chats. Avoid simultaneous manual and delegated edits to the same files. A turn has a 30–1800 second deadline, including waiting for input. Completed sessions stay available about ten minutes for follow-up, then close. `pi_stop` releases them immediately. MCP disconnect or shutdown stops bridge processes.

Small snapshots are stored in this directory's `.state/` with private permissions and survive restarts; they contain task output and dialog text, not raw credentials or full tool logs. Live jobs are not automatically resumed after a restart. Snapshots are retained until removed. Results are capped at 24,000 characters; for large deliverables, have an authorized edit task write the artifact to a specified project path. Status usage is for the last assistant message, not a cumulative invoice.

## Validation and maintenance

Run `python3 -m unittest discover -s <this-directory> -p test_bridge.py -v`.

After changing MCP registration, use Codex Settings → MCP servers → Restart. Configuration is shared by local Codex clients. A fresh-client discovery check verifies the saved registration but does not reload an already-running chat's tool catalog.

The `backups/` directory contains the prior Codex config and instructions. Keep it private. To undo this setup, remove only the `pi-rpc` MCP table and the `Existing Pi worker` section from Codex configuration/instructions. Preserve unrelated later changes. Pi settings and orchestration require no rollback.
