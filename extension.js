const path = require('path');
const vscode = require('vscode');
const extensionPackage = require('./package.json');

const SETTINGS_SECTION = 'agentTerminal';
const PROFILE_MANAGER_VIEW_TYPE = 'agentTerminal.profileManager';
const STORAGE_KEY = `${SETTINGS_SECTION}.config`;
const UNLOCK_EDITOR_GROUP_COMMAND = 'workbench.action.unlockEditorGroup';
const DEFAULT_CONFIGURATION = Object.freeze({
  terminalName: 'Agent',
  activeProfile: '',
  profiles: {}
});

let profileManagerPanel = null;
let lastLaunchedTerminal = null;
let extensionGlobalState = null;
let extensionWorkspaceState = null;

async function activate(context) {
  extensionGlobalState = context.globalState;
  extensionWorkspaceState = context.workspaceState;
  await migrateLegacyConfigurationIfNeeded();

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

  const terminalCloseWatcher = vscode.window.onDidCloseTerminal((terminal) => {
    if (terminal === lastLaunchedTerminal) {
      lastLaunchedTerminal = null;
    }
  });

  context.subscriptions.push(
    startCommand,
    manageProfilesCommand,
    refSelectionCommand,
    refFileCommand,
    terminalCloseWatcher
  );
}

function loadConfiguration() {
  return loadScopedConfiguration(undefined);
}

function loadScopedConfiguration(targetId) {
  const normalizedTargetId = normalizeTargetId(targetId);
  const stored = getStoredConfiguration(normalizedTargetId);
  return {
    terminalName: readString(stored.terminalName, DEFAULT_CONFIGURATION.terminalName),
    activeProfile: readString(stored.activeProfile, DEFAULT_CONFIGURATION.activeProfile),
    profiles: readObject(stored.profiles, DEFAULT_CONFIGURATION.profiles)
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

function readObject(value, fallback) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  return value;
}

function getStorageMemento(targetId) {
  return targetId === 'workspace' ? extensionWorkspaceState : extensionGlobalState;
}

function getStoredConfiguration(targetId) {
  const memento = getStorageMemento(targetId);
  const stored = memento ? memento.get(STORAGE_KEY) : undefined;
  const value = readObject(stored, {});
  return {
    terminalName: readString(value.terminalName, DEFAULT_CONFIGURATION.terminalName),
    activeProfile: readString(value.activeProfile, DEFAULT_CONFIGURATION.activeProfile),
    profiles: readObject(value.profiles, DEFAULT_CONFIGURATION.profiles)
  };
}

function hasStoredConfiguration(targetId) {
  const memento = getStorageMemento(targetId);
  if (!memento) {
    return false;
  }

  return memento.get(STORAGE_KEY) !== undefined;
}

async function saveScopedConfiguration(targetId, config) {
  const normalizedTargetId = normalizeTargetId(targetId);
  const memento = getStorageMemento(normalizedTargetId);
  if (!memento) {
    throw new Error(`Storage target "${normalizedTargetId}" is not available.`);
  }

  await memento.update(STORAGE_KEY, {
    terminalName: readString(config.terminalName, DEFAULT_CONFIGURATION.terminalName),
    activeProfile: readString(config.activeProfile, DEFAULT_CONFIGURATION.activeProfile),
    profiles: readObject(config.profiles, DEFAULT_CONFIGURATION.profiles)
  });
}

async function migrateLegacyConfigurationIfNeeded() {
  await migrateLegacyConfigurationTarget('user');

  if (hasWorkspaceSettingsTarget()) {
    await migrateLegacyConfigurationTarget('workspace');
  }
}

async function migrateLegacyConfigurationTarget(targetId) {
  if (hasStoredConfiguration(targetId)) {
    return;
  }

  const settings = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  const legacyConfig = {
    terminalName: readLegacyScopedString(settings.inspect('terminalName'), targetId, DEFAULT_CONFIGURATION.terminalName),
    activeProfile: readLegacyScopedString(settings.inspect('activeProfile'), targetId, DEFAULT_CONFIGURATION.activeProfile),
    profiles: readLegacyScopedObject(settings.inspect('profiles'), targetId, DEFAULT_CONFIGURATION.profiles)
  };

  const hasLegacyValues = Boolean(
    legacyConfig.terminalName !== DEFAULT_CONFIGURATION.terminalName ||
    legacyConfig.activeProfile !== DEFAULT_CONFIGURATION.activeProfile ||
    Object.keys(legacyConfig.profiles).length > 0
  );

  if (!hasLegacyValues) {
    return;
  }

  await saveScopedConfiguration(targetId, legacyConfig);
}

function readLegacyScopedString(inspectedSetting, targetId, fallback) {
  const value = readLegacyScopedValue(inspectedSetting, targetId);
  return readString(value, fallback);
}

function readLegacyScopedObject(inspectedSetting, targetId, fallback) {
  const value = readLegacyScopedValue(inspectedSetting, targetId);
  return readObject(value, fallback);
}

function readLegacyScopedValue(inspectedSetting, targetId) {
  if (!inspectedSetting) {
    return undefined;
  }

  if (targetId === 'workspace') {
    return inspectedSetting.workspaceValue;
  }

  return inspectedSetting.globalValue;
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
  const profiles = normalizeProfiles(config.profiles);

  if (activeProfile && !profiles.some((profile) => profile.name === activeProfile)) {
    throw new Error(`Active profile "${activeProfile}" does not exist in ${targetId} settings.`);
  }

  await saveScopedConfiguration(targetId, {
    ...config,
    terminalName,
    activeProfile
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

function normalizeIncomingProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Profile payload is invalid.');
  }

  const name = readString(value.name, '');
  if (!name) {
    throw new Error('Profile name is required.');
  }

  return normalizeProfile(name, value);
}

function serializeProfilesConfig(profiles) {
  const result = {};
  for (const profile of profiles) {
    result[profile.name] = serializeProfileConfigValue(profile);
  }
  return result;
}

function serializeProfileConfigValue(profile) {
  const value = {
    label: readString(profile.label, profile.name),
    description: readString(profile.description, ''),
    command: readString(profile.command, ''),
    args: Array.isArray(profile.args) ? profile.args : [],
    cwd: readString(profile.cwd, ''),
    env: profile.env && typeof profile.env === 'object' && !Array.isArray(profile.env) ? profile.env : {},
    terminalName: readString(profile.terminalName, '')
  };

  if (profile.commandLine) {
    value.commandLine = readString(profile.commandLine, '');
  }

  return value;
}

function normalizeTargetId(value) {
  if (value === 'workspace' && hasWorkspaceSettingsTarget()) {
    return 'workspace';
  }

  return 'user';
}

function hasWorkspaceSettingsTarget() {
  return Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
}

function detectDefaultTargetId() {
  if (hasWorkspaceSettingsTarget() && hasStoredConfiguration('workspace')) {
    return 'workspace';
  }

  return 'user';
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
      profiles: profiles.map((profile) => ({
        name: profile.name,
        label: profile.label,
        description: profile.description,
        command: profile.command,
        args: profile.args,
        cwd: profile.cwd,
        env: profile.env,
        terminalName: profile.terminalName,
        commandLine: profile.commandLine
      }))
    }
  });
}

function createProfileManagerHtml(webview) {
  const nonce = getNonce();
  const title = escapeHtml(extensionPackage.displayName);
  const shortcutLabels = getDefaultShortcutLabels();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} Settings</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--vscode-foreground);
        background: radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background) 12%, transparent), transparent 32%),
          linear-gradient(180deg, var(--vscode-editor-background), color-mix(in srgb, var(--vscode-editor-background) 85%, black));
        font-family: var(--vscode-font-family);
      }

      .shell {
        padding: 24px;
        display: grid;
        gap: 18px;
      }

      .hero,
      .card {
        border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
        background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.08);
      }

      .hero {
        padding: 22px 24px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
      }

      .hero h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }

      .hero p {
        margin: 10px 0 0;
        max-width: 720px;
        color: var(--vscode-descriptionForeground);
      }

      .hero-actions,
      .inline-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .card {
        padding: 18px;
      }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }

      .panel-header {
        padding: 16px 18px;
        border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 16px;
      }

      .panel-header p {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .card-header {
        padding: 0 0 14px;
        border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
        display: grid;
        gap: 6px;
      }

      .card-header h2 {
        margin: 0;
        font-size: 20px;
      }

      .card-header p {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .profile-manager {
        padding: 0;
      }

      .profile-toolbar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .profile-list {
        padding: 18px;
        display: grid;
        gap: 16px;
      }

      .profile-card {
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--vscode-input-border) 70%, transparent);
        background: color-mix(in srgb, var(--vscode-input-background) 65%, transparent);
        color: inherit;
        text-align: left;
        padding: 16px;
        display: grid;
        gap: 14px;
      }

      .profile-card:focus-within {
        border-color: var(--vscode-focusBorder);
        background: color-mix(in srgb, var(--vscode-button-background) 8%, var(--vscode-input-background));
      }

      .profile-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }

      .profile-card-title {
        min-width: 0;
      }

      .profile-card-title h3 {
        margin: 0;
        font-size: 18px;
      }

      .profile-card-title p {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .profile-badge {
        white-space: nowrap;
        padding: 2px 8px;
        border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
        color: var(--vscode-focusBorder);
        font-size: 11px;
      }

      .profile-card-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: space-between;
      }

      .profile-card-fields {
        display: grid;
        gap: 14px;
      }

      .secondary.active-toggle {
        border-color: var(--vscode-focusBorder);
        background: color-mix(in srgb, var(--vscode-button-background) 16%, var(--vscode-button-secondaryBackground));
      }

      .empty-list {
        padding: 32px 20px;
        text-align: center;
        color: var(--vscode-descriptionForeground);
      }

      .editor-content {
        padding: 18px;
        display: grid;
        gap: 14px;
      }

      .field-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }

      label {
        display: grid;
        gap: 6px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      input,
      select,
      textarea,
      button {
        font: inherit;
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--vscode-input-border) 60%, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 9px 10px;
      }

      textarea {
        resize: vertical;
        min-height: 96px;
      }

      button {
        border: 1px solid transparent;
        padding: 9px 14px;
        cursor: pointer;
      }

      .primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .danger {
        background: color-mix(in srgb, var(--vscode-errorForeground) 18%, transparent);
        color: var(--vscode-errorForeground);
        border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, transparent);
      }

      .status {
        min-height: 18px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .status.success {
        color: var(--vscode-testing-iconPassed);
      }

      .status.error {
        color: var(--vscode-errorForeground);
      }

      .shortcut-list {
        display: grid;
        gap: 0;
        margin-top: 12px;
      }

      .shortcut-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 12px;
        align-items: center;
        padding: 14px 0;
        border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
      }

      .shortcut-row:last-child {
        padding-bottom: 0;
        border-bottom: 0;
      }

      .shortcut-meta {
        min-width: 0;
      }

      .shortcut-title {
        margin: 0;
        font-size: 14px;
      }

      .shortcut-description {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .shortcut-pill {
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, var(--vscode-input-border) 60%, transparent);
        background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent);
        font-size: 12px;
        white-space: nowrap;
      }

      .hint {
        margin: 0;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .mono {
        font-family: var(--vscode-editor-font-family);
      }

      .modal-shell {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 28px;
        background: rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(6px);
      }

      .modal-shell.open {
        display: flex;
      }

      .modal-card {
        width: min(920px, 100%);
        max-height: calc(100vh - 56px);
        overflow: auto;
        border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
        background: var(--vscode-editor-background);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.22);
      }

      .modal-header {
        padding: 18px 20px;
        border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 18px;
      }

      .modal-header h2 {
        margin: 0;
        font-size: 22px;
      }

      .modal-header p {
        margin: 6px 0 0;
        color: var(--vscode-descriptionForeground);
      }

      .modal-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      @media (max-width: 960px) {
        .hero {
          flex-direction: column;
        }

        .panel-header,
        .profile-card-header,
        .profile-card-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .profile-toolbar {
          justify-content: flex-start;
        }

        .field-grid,
        .shortcut-row {
          grid-template-columns: 1fr;
        }

        .shell {
          padding: 16px;
        }

        .profile-list {
          padding: 14px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div>
          <h1>${title} Settings</h1>
          <p>Manage launcher profiles, targets, and shortcuts from one settings panel.</p>
        </div>
        <div class="hero-actions">
          <button class="secondary" id="openKeybindingsButton" type="button">Keyboard Shortcuts</button>
        </div>
      </section>

      <section class="card">
        <div class="card-grid">
          <label>
            Settings Target
            <select id="targetSelect"></select>
          </label>
          <label>
            Base Terminal Name
            <input id="terminalNameInput" type="text" placeholder="Agent">
          </label>
          <label>
            Active Profile
            <select id="activeProfileSelect"></select>
          </label>
        </div>
        <div class="inline-actions" style="margin-top: 14px;">
          <button class="primary" id="saveGeneralButton" type="button">Save Settings</button>
          <span class="status" id="generalStatus"></span>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Keyboard Shortcuts</h2>
          <p>VS Code stores keybindings separately from settings. Use these links to edit shortcuts in the native Keyboard Shortcuts UI.</p>
        </div>
        <div class="shortcut-list">
          <div class="shortcut-row">
            <div class="shortcut-meta">
              <h3 class="shortcut-title">Start Agent Terminal</h3>
              <p class="shortcut-description">Launch the profile picker and open the selected agent terminal.</p>
            </div>
            <code class="shortcut-pill">${shortcutLabels.start}</code>
            <button class="secondary" type="button" data-keybinding-command="agentTerminal.start">Customize</button>
          </div>
          <div class="shortcut-row">
            <div class="shortcut-meta">
              <h3 class="shortcut-title">Manage Profiles</h3>
              <p class="shortcut-description">Open the settings panel without using the editor title bar.</p>
            </div>
            <code class="shortcut-pill">${shortcutLabels.manageProfiles}</code>
            <button class="secondary" type="button" data-keybinding-command="agentTerminal.manageProfiles">Customize</button>
          </div>
          <div class="shortcut-row">
            <div class="shortcut-meta">
              <h3 class="shortcut-title">Reference File or Selection</h3>
              <p class="shortcut-description">Send the current file or selected line range to the active agent terminal.</p>
            </div>
            <code class="shortcut-pill">${shortcutLabels.refSelection}</code>
            <button class="secondary" type="button" data-keybinding-command="agentTerminal.refSelection">Customize</button>
          </div>
          <div class="shortcut-row">
            <div class="shortcut-meta">
              <h3 class="shortcut-title">Reference Whole File</h3>
              <p class="shortcut-description">Always send the full file path instead of the selected range.</p>
            </div>
            <code class="shortcut-pill">${shortcutLabels.refFile}</code>
            <button class="secondary" type="button" data-keybinding-command="agentTerminal.refFile">Customize</button>
          </div>
        </div>
      </section>

      <section class="profile-manager card">
        <div class="panel-header">
          <div>
            <h2>Profiles</h2>
            <p>Each profile is an editable card. Save only the card you changed.</p>
          </div>
          <div class="profile-toolbar">
            <span class="status" id="profilesStatus"></span>
            <button class="secondary" id="newProfileButton" type="button">New Profile</button>
          </div>
        </div>
        <div class="profile-list" id="profileList"></div>
      </section>
    </div>

    <div class="modal-shell" id="profileModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <div>
            <h2 id="modalTitle">New Profile</h2>
            <p>Create a launcher profile without editing raw JSON. Required: profile name and either command or commandLine.</p>
          </div>
          <div class="modal-actions">
            <span class="status" id="modalStatus"></span>
            <button class="secondary" id="closeModalButton" type="button">Close</button>
          </div>
        </div>
        <form class="editor-content" id="modalProfileForm">
          <div class="field-grid">
            <label>
              Profile Name
              <input id="modalProfileNameInput" type="text" placeholder="codex">
            </label>
            <label>
              Label
              <input id="modalProfileLabelInput" type="text" placeholder="Codex">
            </label>
          </div>

          <label>
            Description
            <input id="modalProfileDescriptionInput" type="text" placeholder="Shown in the launcher dropdown">
          </label>

          <div class="field-grid">
            <label>
              Command
              <input id="modalProfileCommandInput" type="text" placeholder="codex">
            </label>
            <label>
              Terminal Name Override
              <input id="modalProfileTerminalNameInput" type="text" placeholder="Optional tab name">
            </label>
          </div>

          <label>
            Args
            <textarea id="modalProfileArgsInput" placeholder="One argument per line"></textarea>
          </label>

          <label>
            Working Directory
            <input id="modalProfileCwdInput" type="text" placeholder=".">
          </label>

          <label>
            Environment Variables
            <textarea id="modalProfileEnvInput" placeholder="KEY=value&#10;ANOTHER_KEY=value"></textarea>
          </label>

          <label>
            Legacy Command Line
            <input id="modalProfileCommandLineInput" type="text" placeholder="Optional raw command line">
          </label>

          <p class="hint">Use either <span class="mono">command</span> or <span class="mono">commandLine</span>. When both are present, the launcher uses <span class="mono">command</span>.</p>

          <div class="inline-actions">
            <button class="primary" id="saveModalProfileButton" type="submit">Create Profile</button>
            <button class="secondary" id="cancelModalButton" type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        targetId: 'user',
        hasWorkspaceTarget: false,
        terminalName: 'Agent',
        activeProfile: '',
        profiles: []
      };

      let isCreatingProfile = false;

      const targetSelect = document.getElementById('targetSelect');
      const terminalNameInput = document.getElementById('terminalNameInput');
      const activeProfileSelect = document.getElementById('activeProfileSelect');
      const saveGeneralButton = document.getElementById('saveGeneralButton');
      const generalStatus = document.getElementById('generalStatus');
      const profileList = document.getElementById('profileList');
      const profilesStatus = document.getElementById('profilesStatus');
      const newProfileButton = document.getElementById('newProfileButton');
      const profileModal = document.getElementById('profileModal');
      const modalStatus = document.getElementById('modalStatus');
      const modalProfileForm = document.getElementById('modalProfileForm');
      const modalProfileNameInput = document.getElementById('modalProfileNameInput');
      const modalProfileLabelInput = document.getElementById('modalProfileLabelInput');
      const modalProfileDescriptionInput = document.getElementById('modalProfileDescriptionInput');
      const modalProfileCommandInput = document.getElementById('modalProfileCommandInput');
      const modalProfileTerminalNameInput = document.getElementById('modalProfileTerminalNameInput');
      const modalProfileArgsInput = document.getElementById('modalProfileArgsInput');
      const modalProfileCwdInput = document.getElementById('modalProfileCwdInput');
      const modalProfileEnvInput = document.getElementById('modalProfileEnvInput');
      const modalProfileCommandLineInput = document.getElementById('modalProfileCommandLineInput');

      window.addEventListener('message', (event) => {
        const message = event.data;

        if (!message || typeof message !== 'object') {
          return;
        }

        if (message.type === 'state') {
          applyState(message.state);
          return;
        }

        if (message.type === 'saved') {
          if (typeof message.profileName === 'string' && message.profileName) {
            if (isCreatingProfile) {
              closeProfileModal();
            } else {
              isCreatingProfile = false;
            }
          }

          if (typeof message.deletedProfileName === 'string') {
            isCreatingProfile = false;
          }

          setStatus(generalStatus, message.message, 'success');
          setStatus(profilesStatus, message.message, 'success');
          renderGeneralSettings();
          renderProfileList();
          return;
        }

        if (message.type === 'error') {
          setStatus(generalStatus, message.message, 'error');
          setStatus(profilesStatus, message.message, 'error');
          setStatus(modalStatus, message.message, 'error');
        }
      });

      targetSelect.addEventListener('change', () => {
        vscode.postMessage({
          type: 'changeTarget',
          targetId: targetSelect.value
        });
      });

      saveGeneralButton.addEventListener('click', () => {
        vscode.postMessage({
          type: 'saveGeneralSettings',
          targetId: state.targetId,
          terminalName: terminalNameInput.value,
          activeProfile: activeProfileSelect.value
        });
      });

      document.getElementById('openKeybindingsButton').addEventListener('click', () => {
        vscode.postMessage({ type: 'openKeybindings', commandId: '' });
      });

      document.querySelectorAll('[data-keybinding-command]').forEach((button) => {
        button.addEventListener('click', () => {
          vscode.postMessage({
            type: 'openKeybindings',
            commandId: button.getAttribute('data-keybinding-command') || ''
          });
        });
      });

      newProfileButton.addEventListener('click', () => {
        openProfileModal();
      });

      document.getElementById('closeModalButton').addEventListener('click', () => {
        closeProfileModal();
      });

      document.getElementById('cancelModalButton').addEventListener('click', () => {
        closeProfileModal();
      });

      profileModal.addEventListener('click', (event) => {
        if (event.target === profileModal) {
          closeProfileModal();
        }
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isCreatingProfile) {
          closeProfileModal();
        }
      });

      modalProfileForm.addEventListener('submit', (event) => {
        event.preventDefault();

        vscode.postMessage({
          type: 'saveProfile',
          targetId: state.targetId,
          originalName: '',
          profile: {
            name: modalProfileNameInput.value.trim(),
            label: modalProfileLabelInput.value.trim(),
            description: modalProfileDescriptionInput.value.trim(),
            command: modalProfileCommandInput.value.trim(),
            args: parseLines(modalProfileArgsInput.value),
            cwd: modalProfileCwdInput.value.trim(),
            env: parseEnv(modalProfileEnvInput.value),
            terminalName: modalProfileTerminalNameInput.value.trim(),
            commandLine: modalProfileCommandLineInput.value.trim()
          }
        });
      });

      function applyState(nextState) {
        state.targetId = nextState.targetId;
        state.hasWorkspaceTarget = nextState.hasWorkspaceTarget;
        state.terminalName = nextState.terminalName;
        state.activeProfile = nextState.activeProfile;
        state.profiles = Array.isArray(nextState.profiles) ? nextState.profiles : [];

        renderGeneralSettings();
        renderProfileList();
      }

      function renderGeneralSettings() {
        targetSelect.innerHTML = '';

        appendOption(targetSelect, 'user', 'User settings');
        if (state.hasWorkspaceTarget) {
          appendOption(targetSelect, 'workspace', 'Workspace settings');
        }
        targetSelect.value = state.targetId;

        terminalNameInput.value = state.terminalName || 'Agent';

        activeProfileSelect.innerHTML = '';
        appendOption(activeProfileSelect, '', 'None');
        state.profiles.forEach((profile) => {
          appendOption(activeProfileSelect, profile.name, profile.label || profile.name);
        });
        activeProfileSelect.value = state.activeProfile || '';
      }

      function renderProfileList() {
        profileList.innerHTML = '';
        newProfileButton.classList.toggle('active-toggle', isCreatingProfile);

        if (state.profiles.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'empty-list';
          empty.textContent = 'No profiles in this settings target yet. Use New Profile to create one.';
          profileList.appendChild(empty);
          return;
        }

        state.profiles.forEach((profile) => {
          profileList.appendChild(createProfileCard(profile));
        });
      }

      function createProfileCard(profile) {
        const form = document.createElement('form');
        form.className = 'profile-card';

        const header = document.createElement('div');
        header.className = 'profile-card-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'profile-card-title';

        const title = document.createElement('h3');
        title.textContent = profile.label || profile.name;
        titleWrap.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Key: ' + profile.name;
        titleWrap.appendChild(subtitle);
        header.appendChild(titleWrap);

        if (profile.name === state.activeProfile) {
          const badge = document.createElement('span');
          badge.className = 'profile-badge';
          badge.textContent = 'Active';
          header.appendChild(badge);
        }

        form.appendChild(header);

        const fields = document.createElement('div');
        fields.className = 'profile-card-fields';

        const identityGrid = createFieldGrid();
        appendInputField(identityGrid, 'Profile Name', 'profileName', profile.name || '', 'codex');
        appendInputField(identityGrid, 'Label', 'profileLabel', profile.label || '', 'Codex');
        fields.appendChild(identityGrid);

        appendInputField(fields, 'Description', 'profileDescription', profile.description || '', 'Shown in the launcher dropdown');

        const commandGrid = createFieldGrid();
        appendInputField(commandGrid, 'Command', 'profileCommand', profile.command || '', 'codex');
        appendInputField(commandGrid, 'Terminal Name Override', 'profileTerminalName', profile.terminalName || '', 'Optional tab name');
        fields.appendChild(commandGrid);

        appendTextareaField(fields, 'Args', 'profileArgs', Array.isArray(profile.args) ? profile.args.join('\\n') : '', 'One argument per line');
        appendInputField(fields, 'Working Directory', 'profileCwd', profile.cwd || '', '.');
        appendTextareaField(fields, 'Environment Variables', 'profileEnv', stringifyEnv(profile.env), 'KEY=value\\nANOTHER_KEY=value');
        appendInputField(fields, 'Legacy Command Line', 'profileCommandLine', profile.commandLine || '', 'Optional raw command line');

        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Use either command or commandLine. When both are present, the launcher uses command.';
        fields.appendChild(hint);

        form.appendChild(fields);

        const footer = document.createElement('div');
        footer.className = 'profile-card-actions';

        const actions = document.createElement('div');
        actions.className = 'inline-actions';

        const saveButton = document.createElement('button');
        saveButton.className = 'primary';
        saveButton.type = 'submit';
        saveButton.textContent = 'Save Profile';
        actions.appendChild(saveButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'danger';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete Profile';
        actions.appendChild(deleteButton);

        const cardStatus = document.createElement('span');
        cardStatus.className = 'status';

        footer.appendChild(actions);
        footer.appendChild(cardStatus);
        form.appendChild(footer);

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          setStatus(cardStatus, 'Saving...', '');
          setStatus(profilesStatus, '', '');
          vscode.postMessage({
            type: 'saveProfile',
            targetId: state.targetId,
            originalName: profile.name,
            profile: collectProfileFromForm(form)
          });
        });

        deleteButton.addEventListener('click', () => {
          setStatus(cardStatus, 'Deleting...', '');
          setStatus(profilesStatus, '', '');
          vscode.postMessage({
            type: 'deleteProfile',
            targetId: state.targetId,
            profileName: profile.name
          });
        });

        return form;
      }

      function createFieldGrid() {
        const grid = document.createElement('div');
        grid.className = 'field-grid';
        return grid;
      }

      function appendInputField(parent, labelText, name, value, placeholder) {
        const label = document.createElement('label');
        label.textContent = labelText;

        const input = document.createElement('input');
        input.name = name;
        input.type = 'text';
        input.value = value;
        input.placeholder = placeholder;

        label.appendChild(input);
        parent.appendChild(label);
      }

      function appendTextareaField(parent, labelText, name, value, placeholder) {
        const label = document.createElement('label');
        label.textContent = labelText;

        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = value;
        textarea.placeholder = placeholder;

        label.appendChild(textarea);
        parent.appendChild(label);
      }

      function collectProfileFromForm(form) {
        return {
          name: getFormValue(form, 'profileName'),
          label: getFormValue(form, 'profileLabel'),
          description: getFormValue(form, 'profileDescription'),
          command: getFormValue(form, 'profileCommand'),
          args: parseLines(getFormValue(form, 'profileArgs')),
          cwd: getFormValue(form, 'profileCwd'),
          env: parseEnv(getFormValue(form, 'profileEnv')),
          terminalName: getFormValue(form, 'profileTerminalName'),
          commandLine: getFormValue(form, 'profileCommandLine')
        };
      }

      function getFormValue(form, name) {
        const field = form.elements.namedItem(name);
        return field && typeof field.value === 'string' ? field.value.trim() : '';
      }

      function parseLines(value) {
        return value
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }

      function parseEnv(value) {
        const env = {};
        const lines = value.split(/\\r?\\n/);

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          const separatorIndex = trimmed.indexOf('=');
          if (separatorIndex === -1) {
            env[trimmed] = '';
            continue;
          }

          const key = trimmed.slice(0, separatorIndex).trim();
          const envValue = trimmed.slice(separatorIndex + 1);
          if (key) {
            env[key] = envValue;
          }
        }

        return env;
      }

      function stringifyEnv(env) {
        if (!env || typeof env !== 'object') {
          return '';
        }

        return Object.entries(env)
          .map(([key, value]) => key + '=' + String(value))
          .join('\\n');
      }

      function openProfileModal() {
        isCreatingProfile = true;
        profileModal.classList.add('open');
        profileModal.setAttribute('aria-hidden', 'false');
        modalProfileForm.reset();
        setStatus(modalStatus, '', '');
        setStatus(profilesStatus, '', '');
        renderProfileList();
        window.requestAnimationFrame(() => {
          modalProfileNameInput.focus();
        });
      }

      function closeProfileModal() {
        isCreatingProfile = false;
        profileModal.classList.remove('open');
        profileModal.setAttribute('aria-hidden', 'true');
        setStatus(modalStatus, '', '');
        renderProfileList();
      }

      function appendOption(select, value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }

      function setStatus(element, message, type) {
        if (!element) {
          return;
        }

        element.textContent = message || '';
        element.className = 'status' + (type ? ' ' + type : '');
      }

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let index = 0; index < 32; index += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function getDefaultShortcutLabels() {
  return {
    start: 'Not set',
    manageProfiles: 'Not set',
    refSelection: 'User configured',
    refFile: 'User configured'
  };
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
    rememberTerminal(terminal);
    showTerminalAndUnlockGroup(terminal);
    return;
  }

  const terminal = vscode.window.createTerminal(options);
  rememberTerminal(terminal);
  showTerminalAndUnlockGroup(terminal);
  terminal.sendText(profile.commandLine, true);
}

async function sendEditorReferenceToTerminal(options) {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showErrorMessage('Agent Terminal: Open a file before sending a reference.');
    return;
  }

  const documentUri = activeEditor.document.uri;
  if (documentUri.scheme !== 'file') {
    vscode.window.showErrorMessage('Agent Terminal: Only files on disk can be referenced.');
    return;
  }

  const targetTerminal = resolveReferenceTerminal();
  if (!targetTerminal) {
    const action = await vscode.window.showInformationMessage(
      'Agent Terminal: Start an agent terminal before sending a reference.',
      'Start Agent Terminal'
    );

    if (action === 'Start Agent Terminal') {
      await vscode.commands.executeCommand('agentTerminal.start');
    }
    return;
  }

  const reference = buildEditorReference(activeEditor, options);
  targetTerminal.show();
  targetTerminal.sendText(reference, true);
}

function resolveReferenceTerminal() {
  if (vscode.window.activeTerminal && terminalExists(vscode.window.activeTerminal)) {
    return vscode.window.activeTerminal;
  }

  if (lastLaunchedTerminal && terminalExists(lastLaunchedTerminal)) {
    return lastLaunchedTerminal;
  }

  const terminals = vscode.window.terminals;
  if (!Array.isArray(terminals) || terminals.length === 0) {
    return null;
  }

  return terminals[terminals.length - 1] || null;
}

function rememberTerminal(terminal) {
  lastLaunchedTerminal = terminal;
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

function buildEditorReference(activeEditor, options) {
  const forceWholeFile = Boolean(options && options.forceWholeFile);
  const filePath = activeEditor.document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
  const displayPath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, filePath) || path.basename(filePath) : filePath;
  const selectionInfo = getSelectionInfo(activeEditor.selection, forceWholeFile);
  if (!selectionInfo) {
    return displayPath;
  }

  if (selectionInfo.startLine === selectionInfo.endLine) {
    return `${displayPath}#L${selectionInfo.startLine}`;
  }

  return `${displayPath}#L${selectionInfo.startLine}-L${selectionInfo.endLine}`;
}

function getSelectionInfo(selection, forceWholeFile) {
  if (!selection || forceWholeFile || selection.isEmpty) {
    return null;
  }

  const startLine = selection.start.line + 1;
  let endLine = selection.end.line + 1;
  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    endLine -= 1;
  }

  if (endLine < startLine) {
    endLine = startLine;
  }

  return {
    startLine,
    endLine
  };
}

function resolveTerminalLocation() {
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

  return Boolean(tab.input && tab.input.constructor && tab.input.constructor.name === 'TabInputTerminal');
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
