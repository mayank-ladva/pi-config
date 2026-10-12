# Personal Pi Agent Configuration

This repository contains my Pi coding-agent configuration and the local Codex-to-Pi MCP bridge.

## Contents

- `settings.json` — Pi defaults and enabled models
- `AGENTS.md` — workflow instructions for Pi
- `extensions/` — Pi commands and safety hooks
- `skills/` and `prompts/` — reusable guidance
- `integrations/pi-rpc-bridge/` — local MCP server that lets Codex delegate work to Pi

The bridge is an additional local integration. It does not replace the normal Pi workflow or change Pi's configuration when it selects a model for a delegated session.

## Use

Start Pi in a project directory with `pi`. Pi loads this configuration from `~/.pi/agent`.

This repository is maintained independently. Add its own remote after choosing and creating the new repository.
