const path = require('path');
const vscode = require('vscode');
const {
  debugLog,
  summarizeSelection,
  summarizeTerminal,
  summarizeWorkspaceFolder
} = require('./debug');
const {
  appendPromptToOpenCodeTerminal,
  resolveReferenceTerminal,
  resolveTerminalReferenceFormat,
  sendAtMentionToClaudeTerminal
} = require('./terminal');

async function sendEditorReferenceToTerminal(options) {
  debugLog('Reference command invoked.', {
    forceWholeFile: Boolean(options && options.forceWholeFile),
    activeTerminal: summarizeTerminal(vscode.window.activeTerminal),
    visibleTerminalCount: vscode.window.terminals.length,
    activeTab: summarizeActiveTab()
  });

  const referenceSource = getActiveReferenceSource();
  if (!referenceSource) {
    debugLog('Reference command stopped: no active referenceable editor or tab.');
    vscode.window.showErrorMessage('Agent Terminal: Open a file before sending a reference.');
    return;
  }

  const documentUri = referenceSource.uri;
  debugLog('Reference source resolved.', {
    kind: referenceSource.kind,
    uri: documentUri.toString(),
    scheme: documentUri.scheme,
    authority: documentUri.authority,
    path: documentUri.path,
    fsPath: documentUri.fsPath,
    languageId: referenceSource.languageId || '',
    isUntitled: Boolean(referenceSource.isUntitled),
    isImage: isImageUri(documentUri),
    selection: summarizeSelection(referenceSource.selection),
    workspaceFolder: summarizeWorkspaceFolder(vscode.workspace.getWorkspaceFolder(documentUri))
  });

  if (!isReferenceableDocumentUri(documentUri)) {
    debugLog('Reference command stopped: URI scheme is not referenceable.', {
      scheme: documentUri.scheme,
      uri: documentUri.toString()
    });
    vscode.window.showErrorMessage('Agent Terminal: Only local or SSH remote files can be referenced.');
    return;
  }

  const targetTerminal = resolveReferenceTerminal();
  if (!targetTerminal) {
    debugLog('Reference command stopped: no terminal available.');
    const action = await vscode.window.showInformationMessage(
      'Agent Terminal: Start an agent terminal before sending a reference.',
      'Start Agent Terminal'
    );

    if (action === 'Start Agent Terminal') {
      debugLog('User chose to start agent terminal from reference prompt.');
      await vscode.commands.executeCommand('agentTerminal.start');
    }
    return;
  }

  const referenceFormat = resolveTerminalReferenceFormat(targetTerminal);
  const reference = buildEditorReference(referenceSource, {
    ...options,
    referenceFormat
  });
  debugLog('Sending reference to terminal.', {
    terminal: summarizeTerminal(targetTerminal),
    reference,
    referenceFormat,
    submit: false
  });

  if (referenceFormat === 'opencode') {
    targetTerminal.show();
    const appended = await appendPromptToOpenCodeTerminal(targetTerminal, `${reference} `);
    if (appended) {
      debugLog('Reference sent through opencode bridge.');
      return;
    }
  }

  if (referenceFormat === 'claude') {
    targetTerminal.show();
    const sent = await sendAtMentionToClaudeTerminal(
      targetTerminal,
      buildClaudeAtMentionPayload(referenceSource, options)
    );
    if (sent) {
      debugLog('Reference sent through Claude Code bridge.');
      return;
    }
  }

  if (referenceFormat === 'codex') {
    debugLog('Codex reference will be inserted through terminal input.');
  }

  targetTerminal.show();
  targetTerminal.sendText(`${reference} `, false);
  debugLog('Reference inserted through terminal input.', {
    terminal: summarizeTerminal(targetTerminal),
    reference,
    referenceFormat
  });
}

function buildEditorReference(referenceSource, options) {
  const forceWholeFile = Boolean((options && options.forceWholeFile) || referenceSource.forceWholeFile);
  const referenceFormat = normalizeReferenceFormat(options && options.referenceFormat);
  const displayPath = getEditorReferencePath(referenceSource.uri);
  const selectionInfo = getSelectionInfo(referenceSource.selection, forceWholeFile);

  if (referenceFormat === 'opencode') {
    return buildOpenCodeReference(displayPath, selectionInfo);
  }

  if (referenceFormat === 'claude') {
    return buildClaudeReference(displayPath, selectionInfo);
  }

  if (referenceFormat === 'codex') {
    return buildCodexReference(displayPath, selectionInfo);
  }

  return buildPlainReference(displayPath, selectionInfo);
}

function normalizeReferenceFormat(value) {
  return value === 'opencode' || value === 'claude' || value === 'codex' ? value : 'plain';
}

function buildPlainReference(displayPath, selectionInfo) {
  if (!selectionInfo) {
    return displayPath;
  }

  if (selectionInfo.startLine === selectionInfo.endLine) {
    return `${displayPath}#L${selectionInfo.startLine}`;
  }

  return `${displayPath}#L${selectionInfo.startLine}-L${selectionInfo.endLine}`;
}

function buildOpenCodeReference(displayPath, selectionInfo) {
  if (!selectionInfo) {
    return `@${displayPath}`;
  }

  if (selectionInfo.startLine === selectionInfo.endLine) {
    return `@${displayPath}#L${selectionInfo.startLine}`;
  }

  return `@${displayPath}#L${selectionInfo.startLine}-${selectionInfo.endLine}`;
}

function buildClaudeReference(displayPath, selectionInfo) {
  if (!selectionInfo) {
    return `@${displayPath}`;
  }

  if (selectionInfo.startLine === selectionInfo.endLine) {
    return `@${displayPath}#${selectionInfo.startLine}`;
  }

  return `@${displayPath}#${selectionInfo.startLine}-${selectionInfo.endLine}`;
}

function buildCodexReference(displayPath, selectionInfo) {
  if (!selectionInfo) {
    return `@${displayPath}`;
  }

  if (selectionInfo.startLine === selectionInfo.endLine) {
    return `@${displayPath}#L${selectionInfo.startLine}`;
  }

  return `@${displayPath}#L${selectionInfo.startLine}-L${selectionInfo.endLine}`;
}

function isImageUri(uri) {
  return Boolean(uri) && isImagePath(uri.fsPath || uri.path);
}

function isImagePath(filePath) {
  const extension = path.extname(filePath || '').toLowerCase();
  return [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp'
  ].includes(extension);
}

function buildClaudeAtMentionPayload(referenceSource, options) {
  const selectionInfo = getSelectionInfo(
    referenceSource.selection,
    Boolean((options && options.forceWholeFile) || referenceSource.forceWholeFile)
  );
  const payload = {
    filePath: getClaudeAtMentionFilePath(referenceSource.uri)
  };

  if (selectionInfo) {
    payload.lineStart = selectionInfo.startLine;
    payload.lineEnd = selectionInfo.endLine;
  }

  return payload;
}

function getClaudeAtMentionFilePath(uri) {
  if (uri.scheme === 'file') {
    return uri.fsPath;
  }

  return uri.path;
}

function isReferenceableDocumentUri(uri) {
  return uri && (uri.scheme === 'file' || uri.scheme === 'vscode-remote');
}

function getActiveReferenceSource() {
  const activeEditor = vscode.window.activeTextEditor;
  const activeTabUri = getActiveTabUri();

  if (activeEditor && (!activeTabUri || sameUri(activeEditor.document.uri, activeTabUri))) {
    return {
      kind: 'textEditor',
      uri: activeEditor.document.uri,
      selection: activeEditor.selection,
      languageId: activeEditor.document.languageId,
      isUntitled: activeEditor.document.isUntitled,
      forceWholeFile: false
    };
  }

  if (activeTabUri) {
    return {
      kind: 'tab',
      uri: activeTabUri,
      selection: null,
      languageId: '',
      isUntitled: false,
      forceWholeFile: isImageUri(activeTabUri)
    };
  }

  if (activeEditor) {
    return {
      kind: 'textEditor',
      uri: activeEditor.document.uri,
      selection: activeEditor.selection,
      languageId: activeEditor.document.languageId,
      isUntitled: activeEditor.document.isUntitled,
      forceWholeFile: false
    };
  }

  return null;
}

function getActiveTabUri() {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab || !activeTab.input) {
    return null;
  }

  return getUriFromTabInput(activeTab.input);
}

function getUriFromTabInput(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  if (isVsCodeUri(input.uri)) {
    return input.uri;
  }

  if (isVsCodeUri(input.modified)) {
    return input.modified;
  }

  if (isVsCodeUri(input.notebook)) {
    return input.notebook;
  }

  return null;
}

function isVsCodeUri(value) {
  return value instanceof vscode.Uri;
}

function sameUri(first, second) {
  return Boolean(first && second && first.toString() === second.toString());
}

function summarizeActiveTab() {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return null;
  }

  const uri = getUriFromTabInput(activeTab.input);
  return {
    label: activeTab.label,
    inputType: activeTab.input && activeTab.input.constructor ? activeTab.input.constructor.name : '',
    uri: uri ? uri.toString() : ''
  };
}

function getEditorReferencePath(uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder && workspaceFolder.uri.scheme === uri.scheme && workspaceFolder.uri.authority === uri.authority) {
    const relativePath = path.posix.relative(workspaceFolder.uri.path, uri.path);
    debugLog('Resolved reference path from workspace-relative URI path.', {
      workspacePath: workspaceFolder.uri.path,
      uriPath: uri.path,
      relativePath
    });
    return relativePath || path.posix.basename(uri.path);
  }

  if (uri.scheme === 'file') {
    debugLog('Resolved reference path from local fsPath.', {
      fsPath: uri.fsPath
    });
    return uri.fsPath;
  }

  debugLog('Resolved reference path from remote URI path.', {
    uriPath: uri.path
  });
  return uri.path;
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

module.exports = {
  sendEditorReferenceToTerminal
};
