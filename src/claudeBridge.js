const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { debugLog, summarizeTerminal } = require('./debug');
const { readString } = require('./utils');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const REQUEST_TIMEOUT_MS = 1200;
const CLIENT_WAIT_TIMEOUT_MS = 2500;
const CLIENT_WAIT_INTERVAL_MS = 100;
const CLAUDE_BIN_NAMES = new Set([
  'claude',
  'claude.cmd',
  'claude.exe',
  'claude.ps1',
  'claude-code',
  'claude-code.cmd',
  'claude-code.exe',
  'claude-code.ps1'
]);
const CLAUDE_RUNNERS = new Set([
  'bun',
  'bunx',
  'npx',
  'npx.cmd',
  'npm',
  'npm.cmd',
  'pnpm',
  'pnpm.cmd',
  'yarn',
  'yarn.cmd'
]);
const terminalBridges = new WeakMap();
const activeBridges = new Set();

async function createClaudeBridgeLaunch(profile, referenceFormat) {
  if (referenceFormat !== 'claude') {
    return null;
  }

  if (!looksLikeClaudeProfile(profile)) {
    debugLog('Skipping Claude Code bridge: profile does not look like a Claude launch.', {
      command: profile.command,
      args: profile.args
    });
    return null;
  }

  const requestedPort = readPort(profile.env && profile.env.CLAUDE_CODE_SSE_PORT);
  const bridge = await startClaudeBridge({
    requestedPort,
    claudeConfigDir: readString(profile.env && profile.env.CLAUDE_CONFIG_DIR, ''),
    workspaceFolders: resolveWorkspaceFolders()
  });

  return {
    env: {
      CLAUDE_CODE_SSE_PORT: String(bridge.port),
      CLAUDE_CODE_AUTO_CONNECT_IDE: 'true'
    },
    bridge
  };
}

function attachClaudeBridge(terminal, bridge) {
  if (!terminal || !bridge || !bridge.port) {
    return;
  }

  terminalBridges.set(terminal, bridge);
  activeBridges.add(bridge);
  debugLog('Attached Claude Code bridge to terminal.', {
    terminal: summarizeTerminal(terminal),
    port: bridge.port,
    lockfilePath: bridge.lockfilePath
  });
}

function forgetClaudeBridge(terminal) {
  if (!terminal) {
    return;
  }

  const bridge = terminalBridges.get(terminal);
  terminalBridges.delete(terminal);
  if (bridge) {
    activeBridges.delete(bridge);
    void bridge.dispose();
  }
}

async function disposeAllClaudeBridges() {
  const bridges = Array.from(activeBridges);
  activeBridges.clear();
  await Promise.allSettled(bridges.map((bridge) => bridge.dispose()));
}

async function sendAtMentionToClaudeTerminal(terminal, payload) {
  const bridge = resolveClaudeBridge(terminal);
  if (!bridge) {
    return false;
  }

  const sent = await bridge.sendAtMention(payload);
  debugLog(sent ? 'Reference sent through Claude Code bridge.' : 'Claude Code bridge not ready for reference.', {
    terminal: summarizeTerminal(terminal),
    port: bridge.port,
    payload
  });
  return sent;
}

function resolveClaudeBridge(terminal) {
  if (!terminal) {
    return null;
  }

  const tracked = terminalBridges.get(terminal);
  if (tracked) {
    return tracked;
  }

  return null;
}

async function startClaudeBridge(options) {
  const authToken = crypto.randomBytes(24).toString('base64url');
  const clients = new Set();
  const initializedClients = new WeakSet();
  const pendingFragments = new WeakMap();
  let server;
  let lockfilePath = '';

  const bridge = {
    port: 0,
    lockfilePath: '',
    async sendAtMention(payload) {
      const client = await waitForClient(clients, initializedClients);
      if (!client) {
        return false;
      }

      const params = {
        filePath: payload.filePath
      };
      if (Number.isInteger(payload.lineStart)) {
        params.lineStart = Math.max(0, payload.lineStart - 1);
      }
      if (Number.isInteger(payload.lineEnd)) {
        params.lineEnd = Math.max(0, payload.lineEnd - 1);
      }

      return sendJson(client, {
        jsonrpc: '2.0',
        method: 'at_mentioned',
        params
      });
    },
    async dispose() {
      for (const client of clients) {
        sendCloseFrame(client);
        client.destroy();
      }
      clients.clear();

      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }

      if (lockfilePath) {
        await fs.unlink(lockfilePath).catch(() => {});
      }
    }
  };

  server = http.createServer((request, response) => {
    response.writeHead(404);
    response.end();
  });

  server.on('upgrade', (request, socket) => {
    const token = readHeader(request.headers['x-claude-code-ide-authorization']);
    if (authToken && token !== authToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = readHeader(request.headers['sec-websocket-key']);
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const protocols = readHeader(request.headers['sec-websocket-protocol']);
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ];
    if (protocols.split(',').map((item) => item.trim()).includes('mcp')) {
      responseHeaders.push('Sec-WebSocket-Protocol: mcp');
    }

    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
    clients.add(socket);
    debugLog('Claude Code bridge client connected.', {
      port: bridge.port,
      clientCount: clients.size
    });

    socket.on('data', (chunk) => {
      handleSocketData(socket, chunk, pendingFragments, initializedClients);
    });
    socket.on('close', () => {
      clients.delete(socket);
      pendingFragments.delete(socket);
      debugLog('Claude Code bridge client disconnected.', {
        port: bridge.port,
        clientCount: clients.size
      });
    });
    socket.on('error', (error) => {
      clients.delete(socket);
      pendingFragments.delete(socket);
      debugLog('Claude Code bridge socket error.', {
        port: bridge.port,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  await listen(server, options.requestedPort);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Claude Code bridge failed to resolve a TCP listen address.');
  }
  bridge.port = address.port;
  lockfilePath = await writeLockfile({
    port: bridge.port,
    authToken,
    claudeConfigDir: options.claudeConfigDir,
    workspaceFolders: options.workspaceFolders
  });
  bridge.lockfilePath = lockfilePath;

  debugLog('Claude Code bridge started.', {
    port: bridge.port,
    lockfilePath,
    workspaceFolders: options.workspaceFolders
  });

  return bridge;
}

function listen(server, requestedPort) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      server.close(() => {});
      reject(new Error(`Claude Code bridge listen timed out after ${REQUEST_TIMEOUT_MS}ms.`));
    }, REQUEST_TIMEOUT_MS);

    server.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(requestedPort || 0, '127.0.0.1', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function writeLockfile(options) {
  const ideDir = path.join(resolveClaudeConfigDir(options.claudeConfigDir), 'ide');
  await fs.mkdir(ideDir, { recursive: true });
  const lockfilePath = path.join(ideDir, `${options.port}.lock`);
  await fs.writeFile(lockfilePath, JSON.stringify({
    workspaceFolders: options.workspaceFolders,
    pid: process.pid,
    ideName: 'VS Code',
    transport: 'ws',
    runningInWindows: process.platform === 'win32',
    authToken: options.authToken
  }, null, 2));
  return lockfilePath;
}

function resolveClaudeConfigDir(configDir) {
  return readString(configDir, '') ||
    readString(process.env.CLAUDE_CONFIG_DIR, '') ||
    path.join(os.homedir(), '.claude');
}

function resolveWorkspaceFolders() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const paths = workspaceFolders
    .map((folder) => {
      if (folder.uri.scheme === 'file') {
        return folder.uri.fsPath;
      }

      return folder.uri.path;
    })
    .filter(Boolean);

  if (paths.length > 0) {
    return paths;
  }

  return [process.cwd()];
}

function handleSocketData(socket, chunk, pendingFragments, initializedClients) {
  const state = pendingFragments.get(socket) || {
    buffer: Buffer.alloc(0),
    fragments: []
  };
  state.buffer = Buffer.concat([state.buffer, chunk]);

  while (state.buffer.length >= 2) {
    let frame;
    try {
      frame = readFrame(state.buffer);
    } catch (error) {
      debugLog('Claude Code bridge WebSocket frame error.', {
        error: error instanceof Error ? error.message : String(error)
      });
      socket.destroy();
      return;
    }
    if (!frame) {
      break;
    }

    state.buffer = state.buffer.slice(frame.bytesRead);
    if (frame.opcode === 8) {
      sendCloseFrame(socket);
      socket.end();
      continue;
    }
    if (frame.opcode === 9) {
      sendFrame(socket, 10, frame.payload);
      continue;
    }
    if (frame.opcode === 10) {
      continue;
    }
    if (frame.opcode !== 1 && frame.opcode !== 0) {
      continue;
    }

    if (frame.opcode === 1 && frame.fin) {
      handleJsonRpcMessage(socket, frame.payload.toString('utf8'), initializedClients);
      continue;
    }

    state.fragments.push(frame.payload);
    if (frame.fin) {
      const payload = Buffer.concat(state.fragments);
      state.fragments = [];
      handleJsonRpcMessage(socket, payload.toString('utf8'), initializedClients);
    }
  }

  pendingFragments.set(socket, state);
}

function readFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  let offset = 2;
  let payloadLength = second & 0x7f;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) {
      throw new Error('Claude Code bridge does not support WebSocket payloads larger than 4GB.');
    }
    payloadLength = low;
    offset += 8;
  }

  const masked = Boolean(second & 0x80);
  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    var mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return null;
  }

  let payload = buffer.slice(offset, offset + payloadLength);
  if (masked) {
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    fin: Boolean(first & 0x80),
    opcode: first & 0x0f,
    payload,
    bytesRead: offset + payloadLength
  };
}

function handleJsonRpcMessage(socket, text, initializedClients) {
  let message;
  try {
    message = JSON.parse(text);
  } catch (error) {
    debugLog('Claude Code bridge received invalid JSON-RPC.', {
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    handleJsonRpcRequest(socket, message, initializedClients);
    return;
  }

  debugLog('Claude Code bridge received notification.', {
    method: message.method
  });
}

function handleJsonRpcRequest(socket, message, initializedClients) {
  const method = readString(message.method, '');
  debugLog('Claude Code bridge received request.', {
    id: message.id,
    method
  });

  if (method === 'initialize') {
    initializedClients.add(socket);
    sendResult(socket, message.id, {
      protocolVersion: readString(message.params && message.params.protocolVersion, '2025-06-18'),
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'agent-terminal-launcher',
        title: 'Agent Terminal Launcher',
        version: require('../package.json').version
      },
      instructions: 'Minimal VS Code IDE bridge for Claude Code file references.'
    });
    return;
  }

  if (method === 'ping') {
    sendResult(socket, message.id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResult(socket, message.id, {
      tools: [
        {
          name: 'openFile',
          description: 'Open or reveal a file in VS Code.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string' }
            }
          }
        },
        {
          name: 'getDiagnostics',
          description: 'Return VS Code diagnostics.',
          inputSchema: {
            type: 'object',
            properties: {
              uri: { type: 'string' }
            }
          }
        },
        {
          name: 'closeAllDiffTabs',
          description: 'Close IDE diff tabs opened by Claude Code.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    });
    return;
  }

  if (method === 'tools/call') {
    sendResult(socket, message.id, handleToolCall(message.params || {}));
    return;
  }

  sendError(socket, message.id, -32601, `Method not found: ${method}`);
}

function handleToolCall(params) {
  const name = readString(params.name, '');
  if (name === 'getDiagnostics') {
    return {
      content: [
        {
          type: 'text',
          text: '[]'
        }
      ]
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: ''
      }
    ]
  };
}

function sendResult(socket, id, result) {
  sendJson(socket, {
    jsonrpc: '2.0',
    id,
    result
  });
}

function sendError(socket, id, code, message) {
  sendJson(socket, {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  });
}

function sendJson(socket, value) {
  if (!socket || socket.destroyed || !socket.writable) {
    return false;
  }

  return sendFrame(socket, 1, Buffer.from(JSON.stringify(value), 'utf8'));
}

function sendCloseFrame(socket) {
  if (!socket || socket.destroyed || !socket.writable) {
    return false;
  }

  return sendFrame(socket, 8, Buffer.alloc(0));
}

function sendFrame(socket, opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }

  socket.write(Buffer.concat([header, payload]));
  return true;
}

async function waitForClient(clients, initializedClients) {
  const start = Date.now();
  while (Date.now() - start < CLIENT_WAIT_TIMEOUT_MS) {
    const client = Array.from(clients).find((socket) =>
      !socket.destroyed && socket.writable && initializedClients.has(socket)
    );
    if (client) {
      return client;
    }

    await delay(CLIENT_WAIT_INTERVAL_MS);
  }

  return null;
}

function looksLikeClaudeProfile(profile) {
  if (profile.command) {
    return looksLikeClaudeCommand(profile.command, profile.args);
  }

  return false;
}

function looksLikeClaudeCommand(command, args) {
  const basename = commandBasename(command);
  if (CLAUDE_BIN_NAMES.has(basename)) {
    return true;
  }

  if (!CLAUDE_RUNNERS.has(basename)) {
    return false;
  }

  return Array.isArray(args) && args.some((item) => looksLikeClaudeToken(item));
}

function looksLikeClaudeToken(value) {
  const token = stripQuotes(readString(value, '')).toLowerCase();
  if (CLAUDE_BIN_NAMES.has(commandBasename(token))) {
    return true;
  }

  return token === '@anthropic-ai/claude-code';
}

function commandBasename(command) {
  const value = stripQuotes(readString(command, '')).toLowerCase();
  if (!value) {
    return '';
  }

  return path.win32.basename(path.posix.basename(value));
}

function stripQuotes(value) {
  return String(value).replace(/^["']|["']$/g, '');
}

function readPort(value) {
  const text = readString(value, '');
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

function readHeader(value) {
  if (Array.isArray(value)) {
    return readString(value[0], '');
  }

  return readString(value, '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  attachClaudeBridge,
  createClaudeBridgeLaunch,
  disposeAllClaudeBridges,
  forgetClaudeBridge,
  sendAtMentionToClaudeTerminal
};
