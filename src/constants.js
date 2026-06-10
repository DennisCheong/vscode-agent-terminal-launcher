const SETTINGS_SECTION = 'agentTerminal';
const PROFILE_MANAGER_VIEW_TYPE = 'agentTerminal.profileManager';
const STORAGE_KEY = `${SETTINGS_SECTION}.config`;
const UNLOCK_EDITOR_GROUP_COMMAND = 'workbench.action.unlockEditorGroup';
const DEFAULT_CONFIGURATION = Object.freeze({
  terminalName: 'Agent',
  activeProfile: '',
  debugLogEnabled: false,
  profiles: {}
});

module.exports = {
  SETTINGS_SECTION,
  PROFILE_MANAGER_VIEW_TYPE,
  STORAGE_KEY,
  UNLOCK_EDITOR_GROUP_COMMAND,
  DEFAULT_CONFIGURATION
};
