const http = require('http');
const path = require('path');
const { debugLog, summarizeTerminal } = require('./debug');
const { readString } = require('./utils');

const MIN_PORT = 16384;
const MAX_PORT = 65535;
const REQUEST_TIMEOUT_MS = 900;
const READY_RETRY_COUNT = 10;
const READY_RETRY_DELAY_MS = 200;
const OPENCODE_BIN_NAMES = new Set([
  'opencode',
  'opencode.cmd',
  'opencode.exe',
  'opencode.ps1'
]);
const OPENCODE_RUNNERS = new Set([
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

function createOpenCodeBridgeLaunch(profile, referenceFormat) {
  if (referenceFormat !== 'opencode') {
    return null;
  }

  if (profile.command) {
    return createCommandBridgeLaunch(profile);
  }

  return null;
}

function createCommandBridgeLaunch(profile) {
  if (!looksLikeOpenCodeCommand(profile.command, profile.args)) {
    debugLog('Skipping opencode bridge: command does not look like an opencode launch.', {
      command: profile.command,
      args: profile.args
    });
    return null;
  }

  const args = Array.isArray(profile.args) ? profile.args : [];
  const portInfo = parsePortFromArgs(args);
  const envPort = readPort(profile.env && profile.env._EXTENSION_OPENCODE_PORT);
  const port = resolveBridgePort(portInfo, envPort);
  if (!port) {
    debugLog('Skipping opencode bridge: command args include --port but no fixed numeric port was found.', {
      args
    });
    return null;
  }

  return {
    args: portInfo.hasPort ? args : [...args, '--port', String(port)],
    env: buildBridgeEnv(port),
    bridge: buildBridge(port)
  };
}

function attachOpenCodeBridge(terminal, bridge) {
  if (!terminal || !bridge || !bridge.port) {
    return;
  }

  terminalBridges.set(terminal, bridge);
  debugLog('Attached opencode bridge to terminal.', {
    terminal: summarizeTerminal(terminal),
    port: bridge.port,
    source: bridge.source
  });
}

function forgetOpenCodeBridge(terminal) {
  if (!terminal) {
    return;
  }

  terminalBridges.delete(terminal);
}

async function appendPromptToOpenCodeTerminal(terminal, text) {
  const bridge = resolveOpenCodeBridge(terminal);
  if (!bridge) {
    return false;
  }

  debugLog('Sending reference through opencode bridge.', {
    terminal: summarizeTerminal(terminal),
    port: bridge.port,
    text
  });

  const firstAttempt = await tryAppendPrompt(bridge, text);
  if (firstAttempt.ok) {
    bridge.ready = true;
    return true;
  }

  debugLog('opencode bridge append failed; checking readiness before fallback.', {
    port: bridge.port,
    error: firstAttempt.error
  });

  const ready = await waitForOpenCodeBridge(bridge);
  if (!ready) {
    debugLog('opencode bridge is not ready; falling back to terminal.sendText.', {
      port: bridge.port
    });
    return false;
  }

  const retry = await tryAppendPrompt(bridge, text);
  if (retry.ok) {
    bridge.ready = true;
    return true;
  }

  debugLog('opencode bridge retry failed; falling back to terminal.sendText.', {
    port: bridge.port,
    error: retry.error
  });
  return false;
}

function resolveOpenCodeBridge(terminal) {
  if (!terminal) {
    return null;
  }

  const tracked = terminalBridges.get(terminal);
  if (tracked) {
    return tracked;
  }

  const port = readPort(
    terminal.creationOptions &&
      terminal.creationOptions.env &&
      terminal.creationOptions.env._EXTENSION_OPENCODE_PORT
  );
  if (!port) {
    return null;
  }

  const bridge = buildBridge(port, 'terminalEnv');
  attachOpenCodeBridge(terminal, bridge);
  return bridge;
}

async function tryAppendPrompt(bridge, text) {
  try {
    await postJson(bridge.port, '/tui/append-prompt', { text });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForOpenCodeBridge(bridge) {
  for (let attempt = 0; attempt < READY_RETRY_COUNT; attempt += 1) {
    const isReady = await isOpenCodeReady(bridge.port);
    if (isReady) {
      bridge.ready = true;
      return true;
    }

    await delay(READY_RETRY_DELAY_MS);
  }

  return false;
}

async function isOpenCodeReady(port) {
  try {
    await request({
      method: 'GET',
      port,
      requestPath: '/app'
    });
    return true;
  } catch {
    return false;
  }
}

async function postJson(port, requestPath, body) {
  await request({
    method: 'POST',
    port,
    requestPath,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function request(options) {
  return new Promise((resolve, reject) => {
    const body = options.body || '';
    const requestOptions = {
      hostname: '127.0.0.1',
      port: options.port,
      path: options.requestPath,
      method: options.method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        ...(options.headers || {}),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };

    const req = http.request(requestOptions, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
          return;
        }

        reject(new Error(`HTTP ${res.statusCode || 'unknown'}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function buildBridgeEnv(port) {
  return {
    _EXTENSION_OPENCODE_PORT: String(port),
    OPENCODE_CALLER: 'vscode'
  };
}

function buildBridge(port, source) {
  return {
    port,
    source: source || 'launch',
    ready: false
  };
}

function resolveBridgePort(portInfo, envPort) {
  if (portInfo.port) {
    return portInfo.port;
  }

  if (portInfo.hasPort) {
    return envPort || null;
  }

  return envPort || randomPort();
}

function parsePortFromArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const item = readString(args[index], '');
    if (item === '--port') {
      return {
        hasPort: true,
        port: readPort(args[index + 1])
      };
    }

    if (item.startsWith('--port=')) {
      return {
        hasPort: true,
        port: readPort(item.slice('--port='.length))
      };
    }
  }

  return {
    hasPort: false,
    port: null
  };
}

function looksLikeOpenCodeCommand(command, args) {
  const basename = commandBasename(command);
  if (OPENCODE_BIN_NAMES.has(basename)) {
    return true;
  }

  if (!OPENCODE_RUNNERS.has(basename)) {
    return false;
  }

  return Array.isArray(args) && args.some((item) => looksLikeOpenCodeToken(item));
}

function looksLikeOpenCodeToken(value) {
  const token = stripQuotes(readString(value, '')).toLowerCase();
  if (OPENCODE_BIN_NAMES.has(commandBasename(token))) {
    return true;
  }

  return token === 'opencode' || token.endsWith('/opencode') || token.endsWith('\\opencode');
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
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return null;
  }

  return port;
}

function randomPort() {
  return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  appendPromptToOpenCodeTerminal,
  attachOpenCodeBridge,
  createOpenCodeBridgeLaunch,
  forgetOpenCodeBridge,
  resolveOpenCodeBridge
};
