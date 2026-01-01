# amp-mcp

[![ci](https://github.com/DarkPhilosophy/amp-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/DarkPhilosophy/amp-mcp/actions/workflows/ci.yml)

Run the Amp CLI as an MCP subagent from Codex. This server wraps `amp -x` and exposes two tools:

- `amp_run`: run a new Amp task
- `amp_resume`: resume a project by referencing the last thread for that project

## Requirements

- Node.js 18+
- Amp CLI

Install Amp:

```bash
sudo npm install -g @sourcegraph/amp@latest
```

## Install

### Official install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/DarkPhilosophy/amp-mcp/main/install.sh | bash
```

This will:
- clone/update to `~/.local/share/mcp-servers/amp-mcp`
- auto-detect and update Codex / OpenCode configs (no duplicate entries)

### Manual install (clone + configure yourself)

Clone to the standard MCP location:

```bash
git clone https://github.com/DarkPhilosophy/amp-mcp.git "$HOME/.local/share/mcp-servers/amp-mcp"
```

If you cloned elsewhere, running `./install.sh` will move it into the standard location **and** update Codex / OpenCode configs.
If detection fails, see **Configuration** below.

## Configuration

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.amp]
command = "node"
args = ["$HOME/.local/share/mcp-servers/amp-mcp/index.js"]
startup_timeout_sec = 30.0
```

Restart Codex after changes.

### OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "amp": {
      "type": "local",
      "command": [
        "node",
        "$HOME/.local/share/mcp-servers/amp-mcp/index.js"
      ],
      "enabled": true
    }
  }
}
```

## Usage

Example tool call payload:

```json
{
  "prompt": "Summarize this repo in 3 bullets.",
  "project_dir": "$HOME/Projects/cpufetch",
  "timeout_sec": 120
}
```

Resume a task later:

```json
{
  "prompt": "Continue from earlier and list next steps.",
  "project_dir": "$HOME/Projects/cpufetch"
}
```

## Session persistence

- Thread IDs are stored per project path in:
  `~/.local/share/mcp-servers/amp-mcp/state.json`
- `amp_resume` prepends `@<thread_id>` to the prompt so Amp reuses context.

## Limitations (free mode)

Amp **free mode does not allow `--execute`**, and this MCP uses `amp -x` under the hood.
That means **free mode cannot be used via MCP**. Use `rush` or `smart`, or run Amp
interactively outside MCP for free.

## Configuration

Optional env vars:

- `AMP_BIN`: override the Amp binary path
- `AMP_MCP_STATE`: override the state file path
- `AMP_MCP_DEFAULT_MODE`: default mode passed to Amp (e.g. `rush` or `smart`)

## Roadmap ideas

- Expose full JSON output for deeper introspection
- Allow optional tool restrictions for safer runs
- Add structured task status blocks in output

## License

GNU General Public License v3.0
