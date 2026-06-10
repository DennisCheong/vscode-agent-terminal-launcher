const path = require('path');
const vscode = require('vscode');
const {
  debugLog,
  summarizeSelection,
  summarizeTerminal,
  summarizeWorkspaceFolder
} = require('./debug');
const {
  resolveReferenceTerminal,
  resolveTerminalReferenceFormat
} = require('./terminal');

async function sendEditorReferenceToTerminal(options) {
  debugLog('Reference command invoked.', {
    forceWholeFile: Boolean(options && options.forceWholeFile),
    activeTerminal: summarizeTerminal(vscode.window.activeTerminal),
    visibleTerminalCount: vscode.window.terminals.length
  });

  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    debugLog('Reference command stopped: no active text editor.');
    vscode.window.showErrorMessage('Agent Terminal: Open a file before sending a reference.');
    return;
  }

  const documentUri = activeEditor.document.uri;
  debugLog('Active editor resolved.', {
    uri: documentUri.toString(),
    scheme: documentUri.scheme,
    authority: documentUri.authority,
    path: documentUri.path,
    fsPath: documentUri.fsPath,
    languageId: activeEditor.document.languageId,
    isUntitled: activeEditor.document.isUntitled,
    selection: summarizeSelection(activeEditor.selection),
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
  const reference = buildEditorReference(activeEditor, {
    ...options,
    referenceFormat
  });
  debugLog('Sending reference to terminal.', {
    terminal: summarizeTerminal(targetTerminal),
    reference,
    referenceFormat,
    submit: false
  });
  targetTerminal.show();
  targetTerminal.sendText(`${reference} `, false);
}

function buildEditorReference(activeEditor, options) {
  const forceWholeFile = Boolean(options && options.forceWholeFile);
  const referenceFormat = normalizeReferenceFormat(options && options.referenceFormat);
  const displayPath = getEditorReferencePath(activeEditor.document.uri);
  const selectionInfo = getSelectionInfo(activeEditor.selection, forceWholeFile);

  if (referenceFormat === 'opencode') {
    return buildOpenCodeReference(displayPath, selectionInfo);
  }

  if (referenceFormat === 'claude') {
    return buildClaudeReference(displayPath, selectionInfo);
  }

  return buildPlainReference(displayPath, selectionInfo);
}

function normalizeReferenceFormat(value) {
  return value === 'opencode' || value === 'claude' ? value : 'plain';
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

function isReferenceableDocumentUri(uri) {
  return uri && (uri.scheme === 'file' || uri.scheme === 'vscode-remote');
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
