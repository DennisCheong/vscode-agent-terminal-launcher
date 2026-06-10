const path = require('path');
const vscode = require('vscode');
const { UNLOCK_EDITOR_GROUP_COMMAND } = require('./constants');
const { debugLog, summarizeTerminal } = require('./debug');
const { readString } = require('./utils');

let lastLaunchedTerminal = null;
const terminalReferenceFormats = new WeakMap();

function launchProfile(config, profile) {
  const terminalName = resolveTerminalName(config, profile);
  const options = {
    name: terminalName,
    location: resolveTerminalLocation()
  };

  const resolvedCwd = resolveProfileCwd(profile.cwd);
  if (resolvedCwd) {
    options.cwd = resolvedCwd;
  }

  if (Object.keys(profile.env).length > 0) {
    options.env = profile.env;
  }

  if (profile.command) {
    options.shellPath = profile.command;
    if (profile.args.length > 0) {
      options.shellArgs = profile.args;
    }

    const terminal = vscode.window.createTerminal(options);
    rememberTerminal(terminal, profile);
    showTerminalAndUnlockGroup(terminal);
    return;
  }

  const terminal = vscode.window.createTerminal(options);
  rememberTerminal(terminal, profile);
  showTerminalAndUnlockGroup(terminal);
  terminal.sendText(profile.commandLine, true);
}

function resolveReferenceTerminal() {
  debugLog('Resolving reference terminal.', {
    activeTerminal: summarizeTerminal(vscode.window.activeTerminal),
    lastLaunchedTerminal: summarizeTerminal(lastLaunchedTerminal),
    terminals: vscode.window.terminals.map(summarizeTerminal)
  });

  if (vscode.window.activeTerminal && terminalExists(vscode.window.activeTerminal)) {
    debugLog('Using active terminal for reference.', summarizeTerminal(vscode.window.activeTerminal));
    return vscode.window.activeTerminal;
  }

  if (lastLaunchedTerminal && terminalExists(lastLaunchedTerminal)) {
    debugLog('Using last launched terminal for reference.', summarizeTerminal(lastLaunchedTerminal));
    return lastLaunchedTerminal;
  }

  const terminals = vscode.window.terminals;
  if (!Array.isArray(terminals) || terminals.length === 0) {
    return null;
  }

  const fallbackTerminal = terminals[terminals.length - 1] || null;
  debugLog('Using final terminal fallback for reference.', summarizeTerminal(fallbackTerminal));
  return fallbackTerminal;
}

function handleTerminalClosed(terminal) {
  if (terminal === lastLaunchedTerminal) {
    lastLaunchedTerminal = null;
  }
}

function rememberTerminal(terminal, profile) {
  lastLaunchedTerminal = terminal;
  terminalReferenceFormats.set(terminal, resolveProfileReferenceFormat(profile));
}

function resolveTerminalReferenceFormat(terminal) {
  if (!terminal) {
    return 'plain';
  }

  const trackedFormat = terminalReferenceFormats.get(terminal);
  if (trackedFormat) {
    return trackedFormat;
  }

  if (isOpenCodeTerminalName(terminal.name)) {
    return 'opencode';
  }

  if (isClaudeTerminalName(terminal.name)) {
    return 'claude';
  }

  return 'plain';
}

function resolveProfileReferenceFormat(profile) {
  const explicitFormat = readString(profile.referenceFormat, '').toLowerCase();
  if (explicitFormat === 'plain' || explicitFormat === 'opencode' || explicitFormat === 'claude') {
    return explicitFormat;
  }

  const searchableText = [
    profile.name,
    profile.label,
    profile.description,
    profile.command,
    profile.commandLine,
    profile.terminalName
  ].filter(Boolean).join(' ').toLowerCase();

  if (searchableText.includes('opencode')) {
    return 'opencode';
  }

  if (searchableText.includes('claude')) {
    return 'claude';
  }

  return 'plain';
}

function isOpenCodeTerminalName(name) {
  return typeof name === 'string' && name.toLowerCase().includes('opencode');
}

function isClaudeTerminalName(name) {
  return typeof name === 'string' && name.toLowerCase().includes('claude');
}

function showTerminalAndUnlockGroup(terminal) {
  terminal.show();
  unlockActiveEditorGroupSoon();
}

function unlockActiveEditorGroupSoon() {
  unlockActiveEditorGroup();
  setTimeout(unlockActiveEditorGroup, 100);
}

function unlockActiveEditorGroup() {
  vscode.commands.executeCommand(UNLOCK_EDITOR_GROUP_COMMAND).catch(() => {});
}

function terminalExists(terminal) {
  return vscode.window.terminals.includes(terminal);
}

function resolveTerminalLocation() {
  const reusableGroup = findReusableTerminalGroup();
  if (reusableGroup) {
    return { viewColumn: reusableGroup.viewColumn };
  }

  return { viewColumn: vscode.ViewColumn.Beside };
}

function findReusableTerminalGroup() {
  const tabGroups = vscode.window.tabGroups && vscode.window.tabGroups.all;
  if (!Array.isArray(tabGroups) || tabGroups.length === 0) {
    return null;
  }

  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  if (activeGroup && groupContainsTerminalTab(activeGroup)) {
    return activeGroup;
  }

  const terminalGroups = tabGroups.filter(groupContainsTerminalTab);
  if (terminalGroups.length === 0) {
    return null;
  }

  const rightMostColumn = Math.max(
    ...terminalGroups
      .map((group) => group.viewColumn)
      .filter((viewColumn) => typeof viewColumn === 'number')
  );

  return terminalGroups.find((group) => group.viewColumn === rightMostColumn) || terminalGroups[terminalGroups.length - 1];
}

function groupContainsTerminalTab(group) {
  if (!group || !Array.isArray(group.tabs)) {
    return false;
  }

  return group.tabs.some(isTerminalTab);
}

function isTerminalTab(tab) {
  if (!tab) {
    return false;
  }

  return Boolean(tab.input && tab.input.constructor && tab.input.constructor.name === 'TabInputTerminal');
}

function resolveTerminalName(config, profile) {
  const baseName = readString(profile.terminalName, readString(config.terminalName, 'Agent')) || 'Agent';
  if (profile.terminalName) {
    return baseName;
  }

  return `${baseName} - ${profile.label || profile.name}`;
}

function resolveProfileCwd(profileCwd) {
  const value = readString(profileCwd, '');
  if (!value) {
    return resolveCwd();
  }

  return resolveCwdValue(value);
}

function resolveCwdValue(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  const workspaceCwd = resolveCwd();
  if (!workspaceCwd) {
    return value;
  }

  if (typeof workspaceCwd === 'string') {
    return path.join(workspaceCwd, value);
  }

  return vscode.Uri.joinPath(workspaceCwd, value);
}

function resolveCwd() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  const folderUri = workspaceFolders[0].uri;
  if (folderUri.scheme === 'file') {
    return folderUri.fsPath;
  }

  return folderUri;
}

function formatProfileCommand(profile) {
  if (profile.command) {
    const args = Array.isArray(profile.args) && profile.args.length > 0 ? ' ' + profile.args.join(' ') : '';
    return profile.command + args;
  }

  return profile.commandLine || '';
}

module.exports = {
  formatProfileCommand,
  handleTerminalClosed,
  launchProfile,
  resolveReferenceTerminal,
  resolveTerminalReferenceFormat
};
