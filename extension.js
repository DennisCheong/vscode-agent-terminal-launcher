const path = require('path');
const vscode = require('vscode');
const extensionPackage = require('./package.json');

const SETTINGS_SECTION = 'agentTerminal';
const SETTINGS_SEARCH_QUERY = `@ext:${extensionPackage.publisher}.${extensionPackage.name}`;

function activate(context) {
  const disposable = vscode.commands.registerCommand('agentTerminal.start', async () => {
    let config;

    try {
      config = loadConfiguration();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Agent Terminal: ${message}`);
      return;
    }

    let profiles;
    try {
      profiles = normalizeProfiles(config.profiles);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Agent Terminal: ${message}`);
      return;
    }

    const selection = await pickProfile(profiles, config.activeProfile);
    if (!selection) {
      return;
    }

    if (selection.kind === 'openConfig') {
      await openConfigSettings();
      return;
    }

    launchProfile(config, selection.profile);
  });

  context.subscriptions.push(disposable);
}

function loadConfiguration() {
  const settings = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return {
    terminalName: readString(settings.get('terminalName'), 'Agent'),
    activeProfile: readString(settings.get('activeProfile'), ''),
    profiles: settings.get('profiles', {})
  };
}

function normalizeProfiles(profilesConfig) {
  if (!profilesConfig || typeof profilesConfig !== 'object' || Array.isArray(profilesConfig)) {
    throw new Error(`"${SETTINGS_SECTION}.profiles" must be an object.`);
  }

  const profiles = [];
  for (const [name, value] of Object.entries(profilesConfig)) {
    const profile = normalizeProfile(name, value);
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

function normalizeProfile(name, value) {
  if (typeof value === 'string') {
    const commandLine = value.trim();
    if (!commandLine) {
      return null;
    }

    return {
      name,
      label: name,
      description: '',
      terminalName: '',
      commandLine,
      command: '',
      args: [],
      cwd: '',
      env: {}
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Profile "${name}" must be a string or an object.`);
  }

  const command = readString(value.command, '');
  const commandLine = readString(value.commandLine, '');
  const args = normalizeArgs(value.args, name);
  const env = normalizeEnv(value.env, name);
  const cwd = readString(value.cwd, '');
  const description = readString(value.description, '');
  const terminalName = readString(value.terminalName, '');
  const label = readString(value.label, name) || name;

  if (!command && !commandLine) {
    throw new Error(`Profile "${name}" must include either "command" or "commandLine".`);
  }

  return {
    name,
    label,
    description,
    terminalName,
    commandLine,
    command,
    args,
    cwd,
    env
  };
}

function readString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeArgs(value, profileName) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Profile "${profileName}" field "args" must be an array of strings.`);
  }

  const args = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`Profile "${profileName}" field "args" must contain only strings.`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      args.push(trimmed);
    }
  }

  return args;
}

function normalizeEnv(value, profileName) {
  if (value == null) {
    return {};
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Profile "${profileName}" field "env" must be an object.`);
  }

  const env = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean' && item !== null) {
      throw new Error(`Profile "${profileName}" field "env.${key}" must be a string, number, boolean, or null.`);
    }
    env[key] = item === null ? '' : String(item);
  }

  return env;
}

async function pickProfile(profiles, activeProfileName) {
  const items = profiles.map((profile) => ({
    label: profile.label || profile.name,
    description: profile.description || formatProfileCommand(profile),
    detail: profile.name === activeProfileName ? 'Active profile' : '',
    picked: profile.name === activeProfileName,
    kind: 'profile',
    profile
  }));

  items.push({
    label: '$(gear) Open Settings',
    description: 'Open Agent Terminal Launcher settings',
    alwaysShow: true,
    kind: 'openConfig'
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile or open settings',
    matchOnDescription: true,
    matchOnDetail: true
  });

  return selected || null;
}

async function openConfigSettings() {
  await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_SEARCH_QUERY);
}

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
    terminal.show();
    return;
  }

  const terminal = vscode.window.createTerminal(options);
  terminal.show();
  terminal.sendText(profile.commandLine, true);
}

function resolveTerminalLocation() {
  // Reuse the existing terminal editor group when possible so repeated launches
  // stay in the same right-side tab group instead of splitting again.
  const reusableGroup = findReusableTerminalGroup();
  if (reusableGroup) {
    return { viewColumn: reusableGroup.viewColumn };
  }

  return { viewColumn: vscode.ViewColumn.Beside };
}

function findReusableTerminalGroup() {
  const tabGroups = vscode.window.tabGroups;
  if (!tabGroups || !Array.isArray(tabGroups.all) || tabGroups.all.length === 0) {
    return null;
  }

  const activeGroup = tabGroups.activeTabGroup;
  if (activeGroup && activeGroup.viewColumn > vscode.ViewColumn.One && groupContainsTerminalTab(activeGroup)) {
    return activeGroup;
  }

  let reusableGroup = null;
  for (const group of tabGroups.all) {
    if (group.viewColumn <= vscode.ViewColumn.One) {
      continue;
    }

    if (!groupContainsTerminalTab(group)) {
      continue;
    }

    if (!reusableGroup || group.viewColumn > reusableGroup.viewColumn) {
      reusableGroup = group;
    }
  }

  return reusableGroup;
}

function groupContainsTerminalTab(group) {
  if (!group || !Array.isArray(group.tabs) || group.tabs.length === 0) {
    return false;
  }

  return group.tabs.some(isTerminalTab);
}

function isTerminalTab(tab) {
  if (!tab || !tab.input) {
    return false;
  }

  return Boolean(
    tab.input &&
      tab.input.constructor &&
      tab.input.constructor.name === 'TabInputTerminal'
  );
}

function resolveTerminalName(config, profile) {
  const baseName = readString(profile.terminalName, readString(config.terminalName, 'Agent')) || 'Agent';
  if (profile.terminalName) {
    return baseName;
  }
  return `${baseName} - ${profile.name}`;
}

function resolveProfileCwd(profileCwd) {
  if (profileCwd) {
    return resolveCwdValue(profileCwd);
  }

  return resolveCwd();
}

function resolveCwdValue(value) {
  if (!value) {
    return undefined;
  }

  if (path.isAbsolute(value)) {
    return vscode.Uri.file(value);
  }

  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (folder) {
    return vscode.Uri.joinPath(folder.uri, value);
  }

  return vscode.Uri.file(path.resolve(value));
}

function resolveCwd() {
  const activeEditor = vscode.window.activeTextEditor;

  if (activeEditor) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (workspaceFolder) {
      return workspaceFolder.uri;
    }

    if (activeEditor.document.uri.scheme === 'file') {
      return vscode.Uri.file(path.dirname(activeEditor.document.uri.fsPath));
    }
  }

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri;
  }

  return undefined;
}

function formatProfileCommand(profile) {
  if (profile.command) {
    const args = profile.args && profile.args.length > 0 ? ` ${profile.args.join(' ')}` : '';
    return `${profile.command}${args}`;
  }

  return profile.commandLine;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
