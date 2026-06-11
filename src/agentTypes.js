const AGENT_TYPES = Object.freeze({
  CUSTOM: 'custom',
  CODEX: 'codex',
  OPENCODE: 'opencode',
  CLAUDE: 'claude'
});

const BUILT_IN_AGENT_TYPES = new Set([
  AGENT_TYPES.CODEX,
  AGENT_TYPES.OPENCODE,
  AGENT_TYPES.CLAUDE
]);

const AGENT_TYPE_DEFINITIONS = Object.freeze({
  [AGENT_TYPES.CUSTOM]: Object.freeze({
    label: 'Custom Agent',
    command: '',
    referenceFormat: ''
  }),
  [AGENT_TYPES.CODEX]: Object.freeze({
    label: 'Codex',
    command: 'codex',
    referenceFormat: 'codex'
  }),
  [AGENT_TYPES.OPENCODE]: Object.freeze({
    label: 'opencode',
    command: 'opencode',
    referenceFormat: 'opencode'
  }),
  [AGENT_TYPES.CLAUDE]: Object.freeze({
    label: 'Claude Code',
    command: 'claude',
    referenceFormat: 'claude'
  })
});

function normalizeAgentType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === AGENT_TYPES.CODEX || normalized === AGENT_TYPES.OPENCODE || normalized === AGENT_TYPES.CLAUDE) {
    return normalized;
  }

  return AGENT_TYPES.CUSTOM;
}

function isBuiltInAgentType(agentType) {
  return BUILT_IN_AGENT_TYPES.has(normalizeAgentType(agentType));
}

function getAgentTypeDefinition(agentType) {
  return AGENT_TYPE_DEFINITIONS[normalizeAgentType(agentType)] || AGENT_TYPE_DEFINITIONS[AGENT_TYPES.CUSTOM];
}

function resolveAgentCommand(agentType) {
  return getAgentTypeDefinition(agentType).command;
}

function resolveAgentReferenceFormat(agentType) {
  return getAgentTypeDefinition(agentType).referenceFormat;
}

module.exports = {
  AGENT_TYPES,
  AGENT_TYPE_DEFINITIONS,
  getAgentTypeDefinition,
  isBuiltInAgentType,
  normalizeAgentType,
  resolveAgentCommand,
  resolveAgentReferenceFormat
};
