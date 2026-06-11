const extensionPackage = require('../package.json');
const { escapeHtml, getNonce } = require('./utils');

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

      .checkbox-field {
        align-content: start;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 38px;
        border: 1px solid color-mix(in srgb, var(--vscode-input-border) 60%, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 8px 10px;
      }

      .checkbox-row input {
        width: auto;
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
          <label class="checkbox-field">
            Debug Log
            <span class="checkbox-row">
              <input id="debugLogEnabledInput" type="checkbox">
              Enable Output Channel logging
            </span>
          </label>
        </div>
        <div class="inline-actions" style="margin-top: 14px;">
          <button class="primary" id="saveGeneralButton" type="button">Save Settings</button>
          <button class="secondary" id="showDebugLogButton" type="button">Show Debug Log</button>
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
            <p>Create a launcher profile without editing raw JSON. Custom Agent requires a command.</p>
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
              Agent Type
              <select id="modalProfileAgentTypeInput">
                <option value="custom">Custom Agent</option>
                <option value="codex">Codex</option>
                <option value="opencode">opencode</option>
                <option value="claude">Claude Code</option>
              </select>
            </label>
            <label>
              Label
              <input id="modalProfileLabelInput" type="text" placeholder="Codex">
            </label>
          </div>

          <div class="field-grid">
            <label>
              Command
              <input id="modalProfileCommandInput" type="text" placeholder="codex">
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

          <p class="hint">Built-in agent types are launched by this extension and automatically use their matching file reference format. Custom Agent uses plain file references.</p>

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
        debugLogEnabled: false,
        profiles: []
      };

      let isCreatingProfile = false;

      const targetSelect = document.getElementById('targetSelect');
      const terminalNameInput = document.getElementById('terminalNameInput');
      const activeProfileSelect = document.getElementById('activeProfileSelect');
      const debugLogEnabledInput = document.getElementById('debugLogEnabledInput');
      const saveGeneralButton = document.getElementById('saveGeneralButton');
      const showDebugLogButton = document.getElementById('showDebugLogButton');
      const generalStatus = document.getElementById('generalStatus');
      const profileList = document.getElementById('profileList');
      const profilesStatus = document.getElementById('profilesStatus');
      const newProfileButton = document.getElementById('newProfileButton');
      const profileModal = document.getElementById('profileModal');
      const modalStatus = document.getElementById('modalStatus');
      const modalProfileForm = document.getElementById('modalProfileForm');
      const modalProfileNameInput = document.getElementById('modalProfileNameInput');
      const modalProfileAgentTypeInput = document.getElementById('modalProfileAgentTypeInput');
      const modalProfileLabelInput = document.getElementById('modalProfileLabelInput');
      const modalProfileCommandInput = document.getElementById('modalProfileCommandInput');
      const modalProfileArgsInput = document.getElementById('modalProfileArgsInput');
      const modalProfileCwdInput = document.getElementById('modalProfileCwdInput');
      const modalProfileEnvInput = document.getElementById('modalProfileEnvInput');

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
          activeProfile: activeProfileSelect.value,
          debugLogEnabled: debugLogEnabledInput.checked
        });
      });

      showDebugLogButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'showDebugLog' });
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

      modalProfileAgentTypeInput.addEventListener('change', () => {
        syncModalAgentTypeControls();
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
            agentType: modalProfileAgentTypeInput.value,
            label: modalProfileLabelInput.value.trim(),
            command: modalProfileCommandInput.value.trim(),
            args: parseLines(modalProfileArgsInput.value),
            cwd: modalProfileCwdInput.value.trim(),
            env: parseEnv(modalProfileEnvInput.value)
          }
        });
      });

      function applyState(nextState) {
        state.targetId = nextState.targetId;
        state.hasWorkspaceTarget = nextState.hasWorkspaceTarget;
        state.terminalName = nextState.terminalName;
        state.activeProfile = nextState.activeProfile;
        state.debugLogEnabled = Boolean(nextState.debugLogEnabled);
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
        debugLogEnabledInput.checked = Boolean(state.debugLogEnabled);

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
        appendSelectField(identityGrid, 'Agent Type', 'profileAgentType', normalizeUiAgentType(profile.agentType), getAgentTypeOptions());
        appendInputField(identityGrid, 'Label', 'profileLabel', profile.label || '', 'Codex');
        fields.appendChild(identityGrid);

        const commandGrid = createFieldGrid();
        appendInputField(commandGrid, 'Command', 'profileCommand', profile.command || '', 'codex');
        fields.appendChild(commandGrid);

        appendTextareaField(fields, 'Args', 'profileArgs', Array.isArray(profile.args) ? profile.args.join('\\n') : '', 'One argument per line');
        appendInputField(fields, 'Working Directory', 'profileCwd', profile.cwd || '', '.');
        appendTextareaField(fields, 'Environment Variables', 'profileEnv', stringifyEnv(profile.env), 'KEY=value\\nANOTHER_KEY=value');

        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Built-in agents manage command and file reference format automatically. Custom Agent uses plain file references.';
        fields.appendChild(hint);

        form.appendChild(fields);
        syncProfileAgentTypeControls(form);

        const agentTypeSelect = form.elements.namedItem('profileAgentType');
        if (agentTypeSelect) {
          agentTypeSelect.addEventListener('change', () => {
            syncProfileAgentTypeControls(form);
          });
        }

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

      function appendSelectField(parent, labelText, name, value, options) {
        const label = document.createElement('label');
        label.textContent = labelText;

        const select = document.createElement('select');
        select.name = name;

        options.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          select.appendChild(option);
        });

        select.value = value;
        label.appendChild(select);
        parent.appendChild(label);
      }

      function collectProfileFromForm(form) {
        return {
          name: getFormValue(form, 'profileName'),
          agentType: getFormValue(form, 'profileAgentType') || 'custom',
          label: getFormValue(form, 'profileLabel'),
          command: getFormValue(form, 'profileCommand'),
          args: parseLines(getFormValue(form, 'profileArgs')),
          cwd: getFormValue(form, 'profileCwd'),
          env: parseEnv(getFormValue(form, 'profileEnv'))
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
        modalProfileAgentTypeInput.value = 'custom';
        syncModalAgentTypeControls();
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

      function getAgentTypeOptions() {
        return [
          { value: 'custom', label: 'Custom Agent' },
          { value: 'codex', label: 'Codex' },
          { value: 'opencode', label: 'opencode' },
          { value: 'claude', label: 'Claude Code' }
        ];
      }

      function normalizeUiAgentType(value) {
        if (value === 'codex' || value === 'opencode' || value === 'claude') {
          return value;
        }

        return 'custom';
      }

      function isBuiltInUiAgentType(value) {
        return value === 'codex' || value === 'opencode' || value === 'claude';
      }

      function getManagedCommand(agentType) {
        if (agentType === 'codex') {
          return 'codex';
        }

        if (agentType === 'opencode') {
          return 'opencode';
        }

        if (agentType === 'claude') {
          return 'claude';
        }

        return '';
      }

      function syncModalAgentTypeControls() {
        syncAgentTypeControls({
          agentType: modalProfileAgentTypeInput.value,
          commandInput: modalProfileCommandInput
        });
      }

      function syncProfileAgentTypeControls(form) {
        syncAgentTypeControls({
          agentType: getFormValue(form, 'profileAgentType') || 'custom',
          commandInput: form.elements.namedItem('profileCommand')
        });
      }

      function syncAgentTypeControls(options) {
        const agentType = normalizeUiAgentType(options.agentType);
        const builtIn = isBuiltInUiAgentType(agentType);
        const managedCommand = getManagedCommand(agentType);

        if (options.commandInput) {
          if (builtIn) {
            options.commandInput.value = managedCommand;
            options.commandInput.placeholder = 'Managed by selected agent type';
          } else if (!options.commandInput.placeholder || options.commandInput.placeholder === 'Managed by selected agent type') {
            options.commandInput.placeholder = 'codex';
          }
          options.commandInput.disabled = builtIn;
        }
      }

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
}

function getDefaultShortcutLabels() {
  const isMac = process.platform === 'darwin';
  return {
    start: 'Not set',
    manageProfiles: 'Not set',
    refSelection: isMac ? 'Cmd+Alt+R' : 'Ctrl+Alt+R',
    refFile: isMac ? 'Cmd+Alt+Shift+R' : 'Ctrl+Alt+Shift+R'
  };
}


module.exports = {
  createProfileManagerHtml
};
