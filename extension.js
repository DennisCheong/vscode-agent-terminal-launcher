const vscode = require('vscode');
const extensionPackage = require('./package.json');
const { PROFILE_MANAGER_VIEW_TYPE } = require('./src/constants');
const {
  detectDefaultTargetId,
  hasWorkspaceSettingsTarget,
  initializeConfig,
  loadConfiguration,
  loadScopedConfiguration,
  migrateLegacyConfigurationIfNeeded,
  normalizeIncomingProfile,
  normalizeProfiles,
  normalizeTargetId,
  saveScopedConfiguration,
  serializeProfilesConfig
} = require('./src/config');
const {
  debugLog,
  initializeDebug,
  showDebugLogOutput,
  summarizeWorkspaceFolder
} = require('./src/debug');
const { sendEditorReferenceToTerminal } = require('./src/reference');
const { createProfileManagerHtml } = require('./src/profileManagerHtml');
const {
  formatProfileCommand,
  handleTerminalClosed,
  launchProfile
} = require('./src/terminal');
const {
  readBoolean,
  readString
} = require('./src/utils');

let profileManagerPanel = null;

async function activate(context) {
  initializeConfig(context);
  const outputChannel = initializeDebug(() => {
    try {
      return Boolean(loadConfiguration().debugLogEnabled);
    } catch {
      return false;
    }
  });
  await migrateLegacyConfigurationIfNeeded();
  debugLog('Extension activated.', {
    extensionVersion: extensionPackage.version,
    remoteName: vscode.env.remoteName || '',
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map(summarizeWorkspaceFolder)
  });

  const startCommand = vscode.commands.registerCommand('agentTerminal.start', async () => {
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

    if (selection.kind === 'manageProfiles') {
      await openProfileManager();
      return;
    }

    launchProfile(config, selection.profile);
  });

  const manageProfilesCommand = vscode.commands.registerCommand('agentTerminal.manageProfiles', async () => {
    await openProfileManager();
  });

  const refSelectionCommand = vscode.commands.registerCommand('agentTerminal.refSelection', async () => {
    await sendEditorReferenceToTerminal();
  });

  const refFileCommand = vscode.commands.registerCommand('agentTerminal.refFile', async () => {
    await sendEditorReferenceToTerminal({ forceWholeFile: true });
  });

  const showDebugLogCommand = vscode.commands.registerCommand('agentTerminal.showDebugLog', () => {
    showDebugLogOutput();
  });

  const terminalCloseWatcher = vscode.window.onDidCloseTerminal((terminal) => {
    handleTerminalClosed(terminal);
  });

  context.subscriptions.push(
    startCommand,
    manageProfilesCommand,
    refSelectionCommand,
    refFileCommand,
    showDebugLogCommand,
    terminalCloseWatcher,
    outputChannel
  );
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
    label: '$(edit) Open Settings',
    description: 'Open the visual settings manager',
    alwaysShow: true,
    kind: 'manageProfiles'
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: profiles.length > 0 ? 'Select a profile or manage settings' : 'Create a profile or open settings',
    matchOnDescription: true,
    matchOnDetail: true
  });

  return selected || null;
}

async function openKeybindingSettings(commandId) {
  const normalizedCommandId = readString(commandId, '');
  const query = normalizedCommandId
    ? `@command:${normalizedCommandId}`
    : `@ext:${extensionPackage.publisher}.${extensionPackage.name}`;
  await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', query);
}

async function openProfileManager() {
  if (profileManagerPanel) {
    profileManagerPanel.reveal(vscode.ViewColumn.Active);
    await postProfileManagerState(profileManagerPanel.webview);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    PROFILE_MANAGER_VIEW_TYPE,
    `${extensionPackage.displayName} Settings`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  profileManagerPanel = panel;
  panel.webview.html = createProfileManagerHtml(panel.webview);

  panel.onDidDispose(() => {
    if (profileManagerPanel === panel) {
      profileManagerPanel = null;
    }
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      await handleProfileManagerMessage(panel, message);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await panel.webview.postMessage({
        type: 'error',
        message: text
      });
      vscode.window.showErrorMessage(`Agent Terminal: ${text}`);
    }
  });

  await postProfileManagerState(panel.webview);
}

async function handleProfileManagerMessage(panel, message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  switch (message.type) {
    case 'ready':
      await postProfileManagerState(panel.webview);
      return;
    case 'changeTarget':
      await postProfileManagerState(panel.webview, normalizeTargetId(message.targetId));
      return;
    case 'openKeybindings':
      await openKeybindingSettings(message.commandId);
      return;
    case 'showDebugLog':
      showDebugLogOutput();
      return;
    case 'saveGeneralSettings':
      await saveGeneralSettings(message);
      await postProfileManagerState(panel.webview, normalizeTargetId(message.targetId));
      await panel.webview.postMessage({ type: 'saved', message: 'Settings updated.' });
      return;
    case 'saveProfile':
      {
        const savedProfileName = await saveProfileDefinition(message);
        await postProfileManagerState(panel.webview, normalizeTargetId(message.targetId));
        await panel.webview.postMessage({ type: 'saved', message: 'Profile saved.', profileName: savedProfileName });
      }
      return;
    case 'deleteProfile':
      {
        const deletedProfileName = await deleteProfileDefinition(message);
        await postProfileManagerState(panel.webview, normalizeTargetId(message.targetId));
        await panel.webview.postMessage({ type: 'saved', message: 'Profile deleted.', deletedProfileName });
      }
      return;
    default:
      return;
  }
}

async function saveGeneralSettings(message) {
  const targetId = normalizeTargetId(message.targetId);
  const config = loadScopedConfiguration(targetId);
  const terminalName = readString(message.terminalName, 'Agent');
  const activeProfile = readString(message.activeProfile, '');
  const debugLogEnabled = readBoolean(message.debugLogEnabled, false);
  const profiles = normalizeProfiles(config.profiles);

  if (activeProfile && !profiles.some((profile) => profile.name === activeProfile)) {
    throw new Error(`Active profile "${activeProfile}" does not exist in ${targetId} settings.`);
  }

  await saveScopedConfiguration(targetId, {
    ...config,
    terminalName,
    activeProfile,
    debugLogEnabled
  });
}

async function saveProfileDefinition(message) {
  const targetId = normalizeTargetId(message.targetId);
  const config = loadScopedConfiguration(targetId);
  const profile = normalizeIncomingProfile(message.profile);
  const originalName = readString(message.originalName, profile.name);
  const profiles = normalizeProfiles(config.profiles);
  const updatedProfiles = [];
  let replaced = false;

  for (const existingProfile of profiles) {
    if (existingProfile.name === originalName) {
      updatedProfiles.push(profile);
      replaced = true;
      continue;
    }

    if (existingProfile.name === profile.name) {
      throw new Error(`Profile "${profile.name}" already exists.`);
    }

    updatedProfiles.push(existingProfile);
  }

  if (!replaced) {
    updatedProfiles.push(profile);
  }

  const nextConfig = {
    ...config,
    profiles: serializeProfilesConfig(updatedProfiles)
  };
  if (config.activeProfile === originalName && originalName !== profile.name) {
    nextConfig.activeProfile = profile.name;
  }
  await saveScopedConfiguration(targetId, nextConfig);

  return profile.name;
}

async function deleteProfileDefinition(message) {
  const targetId = normalizeTargetId(message.targetId);
  const config = loadScopedConfiguration(targetId);
  const profileName = readString(message.profileName, '');

  if (!profileName) {
    throw new Error('Profile name is required.');
  }

  const profiles = normalizeProfiles(config.profiles);
  const updatedProfiles = profiles.filter((profile) => profile.name !== profileName);

  if (updatedProfiles.length === profiles.length) {
    throw new Error(`Profile "${profileName}" was not found.`);
  }

  const nextConfig = {
    ...config,
    profiles: serializeProfilesConfig(updatedProfiles)
  };
  if (config.activeProfile === profileName) {
    nextConfig.activeProfile = '';
  }
  await saveScopedConfiguration(targetId, nextConfig);

  return profileName;
}

async function postProfileManagerState(webview, targetId) {
  const resolvedTargetId = normalizeTargetId(targetId || detectDefaultTargetId());
  const config = loadScopedConfiguration(resolvedTargetId);
  const profiles = normalizeProfiles(config.profiles);

  await webview.postMessage({
    type: 'state',
    state: {
      targetId: resolvedTargetId,
      hasWorkspaceTarget: hasWorkspaceSettingsTarget(),
      terminalName: readString(config.terminalName, 'Agent'),
      activeProfile: readString(config.activeProfile, ''),
      debugLogEnabled: readBoolean(config.debugLogEnabled, false),
      profiles: profiles.map((profile) => ({
        name: profile.name,
        label: profile.label,
        description: profile.description,
        command: profile.command,
        args: profile.args,
        cwd: profile.cwd,
        env: profile.env,
        terminalName: profile.terminalName,
        referenceFormat: profile.referenceFormat,
        commandLine: profile.commandLine
      }))
    }
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
