# Agent Terminal Launcher

VS Code extension that adds a button in the editor title bar. Clicking it opens a profile picker from VS Code Settings, then launches the chosen agent CLI in a terminal editor to the right, reusing the existing right-side terminal tab group when one is already open.

## What it does

- Adds `Agent: Start Agent Terminal` to the Command Palette.
- Adds a single button in the editor title bar for regular files, untitled files, and terminal editors.
- Opens a profile dropdown from VS Code Settings.
- Includes an `Open Settings` item in the dropdown so you can jump straight to the extension settings.
- Opens a terminal in the editor area to the side and sends the selected profile command immediately.
- Reuses the existing right-side terminal tab group when one already exists, so repeated launches create new tabs in the same group.

## Configuration

Open VS Code Settings and search for `Agent Terminal Launcher`, or use the `Open Settings` item from the launcher dropdown.

Settings section:

- `agentTerminal.terminalName`: base terminal tab name used for launched agent sessions
- `agentTerminal.activeProfile`: profile name to preselect when the launcher dropdown opens
- `agentTerminal.profiles`: profile definitions keyed by profile name

Example `settings.json`:

```json
{
  "agentTerminal.terminalName": "Agent",
  "agentTerminal.activeProfile": "codex",
  "agentTerminal.profiles": {
    "codex": {
      "label": "Codex",
      "description": "OpenAI Codex",
      "command": "codex",
      "args": [
        "chat",
        "--model",
        "gpt-5.4-mini"
      ],
      "cwd": ".",
      "env": {
        "OPENAI_API_KEY": "your-api-key"
      }
    },
    "claude": {
      "label": "Claude",
      "description": "Anthropic Claude",
      "command": "claude",
      "args": [
        "--dangerously-skip-permissions"
      ],
      "cwd": ".",
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key"
      }
    },
    "opencode": {
      "label": "OpenCode",
      "description": "OpenCode",
      "command": "opencode",
      "args": [],
      "cwd": ".",
      "env": {}
    }
  }
}
```

Supported profile fields:

- `command`: executable to run
- `args`: array of arguments
- `cwd`: working directory, relative to the workspace if not absolute
- `env`: environment variables to set for the terminal session
- `label`: label shown in the picker
- `description`: optional details shown in the picker
- `terminalName`: optional fixed terminal tab name
- `commandLine`: legacy raw command line string for backward compatibility

## Development

1. Open this folder in VS Code.
2. Press `F5` to launch the extension host.
3. Open a file or terminal editor and click the button in the title bar.

## Build VSIX

- macOS/Linux: `./build.sh`
- Windows: `build.bat`

Both scripts run `npm i --no-package-lock --no-audit --no-fund` before packaging, then write the output to `dist/agent-terminal-launcher.vsix` by default.
