const vscode = require('vscode');

let outputChannel = null;
let isEnabled = () => false;

function initializeDebug(isEnabledCallback) {
  outputChannel = vscode.window.createOutputChannel('Agent Terminal Launcher');
  isEnabled = typeof isEnabledCallback === 'function' ? isEnabledCallback : isEnabled;
  return outputChannel;
}

function debugLog(message, details) {
  if (!isEnabled() || !outputChannel) {
    return;
  }

  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);

  if (details !== undefined) {
    outputChannel.appendLine(formatDebugDetails(details));
  }
}

function showDebugLogOutput() {
  if (!outputChannel) {
    return;
  }

  outputChannel.show(true);
  outputChannel.appendLine(`[${new Date().toISOString()}] Debug log output opened.`);
  outputChannel.appendLine('If a keyboard shortcut does not create any new log entry, VS Code did not invoke the extension command.');
  outputChannel.appendLine('Check the keybinding command id and when clause. For SSH Remote files, include: resourceScheme == vscode-remote');
}

function formatDebugDetails(details) {
  try {
    return JSON.stringify(details, null, 2);
  } catch (error) {
    return String(details);
  }
}

function summarizeTerminal(terminal) {
  if (!terminal) {
    return null;
  }

  return {
    name: terminal.name,
    exitStatus: terminal.exitStatus || null
  };
}

function summarizeSelection(selection) {
  if (!selection) {
    return null;
  }

  return {
    isEmpty: selection.isEmpty,
    startLine: selection.start.line + 1,
    startCharacter: selection.start.character,
    endLine: selection.end.line + 1,
    endCharacter: selection.end.character
  };
}

function summarizeWorkspaceFolder(workspaceFolder) {
  if (!workspaceFolder) {
    return null;
  }

  return {
    name: workspaceFolder.name,
    uri: workspaceFolder.uri.toString(),
    scheme: workspaceFolder.uri.scheme,
    authority: workspaceFolder.uri.authority,
    path: workspaceFolder.uri.path,
    fsPath: workspaceFolder.uri.fsPath
  };
}

module.exports = {
  debugLog,
  initializeDebug,
  showDebugLogOutput,
  summarizeSelection,
  summarizeTerminal,
  summarizeWorkspaceFolder
};
