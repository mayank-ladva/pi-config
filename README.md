# Pi config repo

This repository is a portable Pi setup you can clone to other devices.

## What it gives you

- dark UI defaults
- manual model selection
- step-by-step workflow
- `tasks/`-first planning
- risky-command guard
- reusable prompts and skills

## Install

Clone or sync this repo to `~/.pi/agent`.

```bash
git clone https://github.com/mayank-ladva/pi-config ~/.pi/agent
```

Or sync from an existing clone:

```bash
./install.sh ~/.pi/agent
```

Then install the dependencies:

```bash
pi install npm:context-mode
pi install npm:pi-web-access
```

## Notes

- Choose the model manually with `/model` or `Ctrl+L`.
- Keep active work in `tasks/<name>.md` inside each project.
- Start new tasks from `tasks/TASK_TEMPLATE.md`.
- `AGENTS.md` is the canonical workflow file.
- `APPEND_SYSTEM.md` is a legacy minimal override.
- The repo intentionally avoids tracking secrets, sessions, and auth files.

## Layout

- `settings.json` — global Pi settings
- `mcp.json` — MCP server config (context-mode)
- `AGENTS.md` — canonical workflow guidance
- `APPEND_SYSTEM.md` — legacy minimal override
- `tasks/` — active task files and `TASK_TEMPLATE.md`
- `prompts/` — reusable slash commands
- `extensions/` — local TypeScript extensions
- `project-template/` — files to copy into new projects
