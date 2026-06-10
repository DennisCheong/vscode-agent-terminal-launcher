const vscode = require('vscode');
const {
  DEFAULT_CONFIGURATION,
  SETTINGS_SECTION,
  STORAGE_KEY
} = require('./constants');
const {
  readBoolean,
  readObject,
  readString
} = require('./utils');

let extensionGlobalState = null;
let extensionWorkspaceState = null;

function initializeConfig(context) {
  extensionGlobalState = context.globalState;
  extensionWorkspaceState = context.workspaceState;
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
    debugLogEnabled: readBoolean(stored.debugLogEnabled, DEFAULT_CONFIGURATION.debugLogEnabled),
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
      env: {},
      referenceFormat: ''
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
  const referenceFormat = normalizeReferenceFormat(value.referenceFormat, name);
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
    env,
    referenceFormat
  };
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
    debugLogEnabled: readBoolean(value.debugLogEnabled, DEFAULT_CONFIGURATION.debugLogEnabled),
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
    debugLogEnabled: readBoolean(config.debugLogEnabled, DEFAULT_CONFIGURATION.debugLogEnabled),
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
    debugLogEnabled: DEFAULT_CONFIGURATION.debugLogEnabled,
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

function normalizeReferenceFormat(value, profileName) {
  const referenceFormat = readString(value, '').toLowerCase();
  if (!referenceFormat || referenceFormat === 'auto') {
    return referenceFormat;
  }

  if (referenceFormat === 'plain' || referenceFormat === 'opencode' || referenceFormat === 'claude') {
    return referenceFormat;
  }

  throw new Error(`Profile "${profileName}" field "referenceFormat" must be "auto", "plain", "opencode", or "claude".`);
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
    terminalName: readString(profile.terminalName, ''),
    referenceFormat: readString(profile.referenceFormat, '')
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

module.exports = {
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
};
