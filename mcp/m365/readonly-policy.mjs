const MUTATION_KEYWORD_RE = /\b(create|update|delete|remove|write|patch|put|post|send|upload|move|copy|grant|revoke|assign)\b/i;

export function isLikelyMutatingText(value) {
  return MUTATION_KEYWORD_RE.test(String(value || ''));
}

export function assertReadonlyToolDefinitions(tools) {
  for (const tool of tools) {
    const name = String(tool?.name || '');
    if (!name.startsWith('m365_')) {
      throw new Error(`tool name must start with m365_: ${name}`);
    }
    if (isLikelyMutatingText(name)) {
      throw new Error(`mutating keyword detected in tool name: ${name}`);
    }
  }
}

export function assertReadonlyToolCallName(name, knownNames) {
  const normalized = String(name || '').trim();
  if (!knownNames.has(normalized)) {
    throw new Error(`unknown tool: ${normalized}`);
  }
  if (isLikelyMutatingText(normalized)) {
    throw new Error(`mutating tool calls are blocked: ${normalized}`);
  }
  return normalized;
}
