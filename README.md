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
- edit `name`, `label`, `description`, `command`, `args`, `cwd`, `env`, `terminalName`, `referenceFormat`, and legacy `commandLine` directly inside each profile card
- use `Save Profile` to save only the card you changed
- use `Delete Profile` to remove that profile

Debug logging is available from the top settings section:

- enable `Debug Log` when troubleshooting launcher or file reference behavior
- logs are written to the `Agent Terminal Launcher` Output Channel
- use `Agent: Show Debug Log` to open the output directly
- if a keyboard shortcut produces no log entry, VS Code did not invoke the command; check that the keybinding uses `agentTerminal.refSelection` or `agentTerminal.refFile` and that its `when` clause allows `resourceScheme == vscode-remote`
- keep it disabled during normal use

Keyboard shortcuts are managed by VS Code:

- use the built-in `Keyboard Shortcuts` section to open VS Code's native keybinding UI
- default file reference shortcuts support local and SSH remote files
- VS Code does not rewrite existing user-defined keybindings during extension updates; if an old custom shortcut still has `resourceScheme == file`, update or remove that custom keybinding manually

## Profile Fields

- `name`: settings key used for the profile
- `label`: display name shown in the launcher picker
- `description`: optional picker description
- `command`: executable to run directly in the terminal
- `args`: command arguments, one line per argument in the visual editor
- `cwd`: working directory, relative to the workspace if not absolute
- `env`: environment variables, one `KEY=value` pair per line in the visual editor
- `terminalName`: optional fixed terminal tab name
- `referenceFormat`: optional file reference format, either auto detect, `plain`, `opencode`, or `claude`
- `commandLine`: legacy raw command line for compatibility

## Referencing Files

- `Agent: Reference Current File or Selection` sends the active local or SSH remote file path, or `file#L10-L25` when text is selected, to the currently active terminal. If no terminal is focused, it falls back to the last terminal launched by this extension.
- `Agent: Reference Current File` always sends the whole active file.
- opencode profiles use opencode-style references such as `@file#L37-42`, matching opencode's IDE file reference shortcut behavior.
- Claude Code profiles use Claude Code-style references such as `@file#37-42`, matching Claude Code's IDE file mention behavior.
- If no agent terminal is open yet, the extension prompts you to start one first.
- The command inserts the reference followed by a space. It does not press Enter or prepend extra prompt text.


## Build VSIX

- macOS/Linux: `./build.sh`
- Windows: `build.bat`

Both scripts run `npm i --no-package-lock --no-audit --no-fund` before packaging, then write the output to `dist/agent-terminal-launcher.vsix` by default.
