# Validation — 2026-10-07

- 12 automated checks pass: free-model validation, settled-event lifecycle, handled prompts, deadlines, dialogs and expiry, quota failures, saved-state recovery, safe job IDs, Unicode/response correlation, follow-up and conflicting workspace handling.
- Real MCP initialize and six-tool discovery pass.
- Real Pi metadata loads all 13 taskflow commands, existing Ponytail and configured extensions.
- Real free-model task used kilocode/cohere/north-mini-code:free, read a temporary fixture using Pi's read tool and returned the exact number 7319. Pi reported zero cost for its last assistant message. No project file edits were requested.
- A fresh Codex app-server discovered all six registered pi-rpc tools, with toolsError null. No Codex inference request was sent for that discovery check.
- All 33 hashed existing Pi configuration, extension, skill and prompt files match their before-installation hashes.
- Existing Codex configuration outside the old opencode-free/new pi-rpc tables is structurally unchanged. Old Codex files are backed up privately under backups/.

The current already-open chat has not reloaded its tool catalog. Use Settings → MCP servers → Restart for pi-rpc. No Herdr integration was added. See README.md for session, permissions and pricing limitations.
