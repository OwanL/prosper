// Preserve causal evidence without duplicating every schema/prompt in a long
// observation. The source audit already excludes auth and private reasoning.
export function auditEvidence(event) {
  const { request, providerHistory, reasoning_content, thinking, ...evidence } = event;
  if (typeof evidence.reasoning === 'string') delete evidence.reasoning;
  if (event.type === 'agent_request') evidence.availableTools = (request?.tools ?? []).map(t => t.function?.name).filter(Boolean);
  return evidence;
}
