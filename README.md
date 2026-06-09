# Agent Terminal Launcher

VS Code extension for launching agent CLIs such as `codex`, `claude`, or `opencode` in a right-side terminal editor. It keeps launch profiles, terminal behavior, and file reference commands in one visual settings panel.

## What it does

- Launches configurable agent CLI profiles such as `codex`, `claude`, or `opencode` from the editor title bar or Command Palette.
- Opens agent sessions in a right-side terminal editor and reuses the existing right-side terminal tab group when possible.
- Lets you choose a launch profile from a dropdown before starting the terminal.
- Provides a visual profile manager for editing launcher profiles without hand-editing JSON.
- Supports separate user-level and workspace-level launcher settings.
- Sends the current file path or selected line range to an active agent terminal for quick file references.

## Configuration

All launcher settings are managed from the visual profile manager. Open it from either:

- the `Open Agent Terminal Settings` command
- the launcher dropdown item `Manage Profiles`
- the editor title bar edit button

The top settings section controls:

- switching between `User settings` and `Workspace settings`
- setting the base terminal name
- choosing the active default profile

Profile settings are edited as cards:

- use `New Profile` to create a profile from a popup form
- edit `name`, `label`, `description`, `command`, `args`, `cwd`, `env`, `terminalName`, and legacy `commandLine` directly inside each profile card
- use `Save Profile` to save only the card you changed
- use `Delete Profile` to remove that profile

Keyboard shortcuts are managed by VS Code:

- use the built-in `Keyboard Shortcuts` section to open VS Code's native keybinding UI
- this extension does not contribute default shortcuts, so reinstalling the VSIX will not reset user keybindings

## Profile Fields

- `name`: settings key used for the profile
- `label`: display name shown in the launcher picker
- `description`: optional picker description
- `command`: executable to run directly in the terminal
- `args`: command arguments, one line per argument in the visual editor
- `cwd`: working directory, relative to the workspace if not absolute
- `env`: environment variables, one `KEY=value` pair per line in the visual editor
- `terminalName`: optional fixed terminal tab name
- `commandLine`: legacy raw command line for compatibility

## Referencing Files

- `Agent: Reference Current File or Selection` sends the active file path, or `file#L10-L25` when text is selected, to the currently active terminal. If no terminal is focused, it falls back to the last terminal launched by this extension.
- `Agent: Reference Current File` always sends the whole active file.
- If no agent terminal is open yet, the extension prompts you to start one first.
- The command sends only the raw reference string. It does not prepend any extra prompt text.

## Development

1. Open this folder in VS Code.
2. Press `F5` to launch the extension host.
3. Open a file and use either title bar button.

## Build VSIX

- macOS/Linux: `./build.sh`
- Windows: `build.bat`

Both scripts run `npm i --no-package-lock --no-audit --no-fund` before packaging, then write the output to `dist/agent-terminal-launcher.vsix` by default.
