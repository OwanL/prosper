// One authoritative observation per turn, plus tool receipts. Refreshes replace
// snapshots; they never erase action receipts, errors or tool-call pairing.
export function createTurnContext(instructions, observation, { observationPlacement = 'tail' } = {}) {
  if (!['front', 'tail'].includes(observationPlacement)) throw new Error('Observation placement must be front or tail.');
  const current = { role: 'user', content: JSON.stringify(observation) };
  const messages = [{ role: 'system', content: instructions }, current];
  const replace = context => { current.content = JSON.stringify(context); };
  const queries = new Map();
  return {
    messages,
    observationMessageBytes() { return Buffer.byteLength(JSON.stringify(current)); },
    refresh: replace,
    prepare() {
      // Move only at the request boundary, after every tool result in a batch.
      // Moving during result() would split an assistant's tool calls from their
      // receipts, which some providers reject. Retain one snapshot, not copies.
      if (observationPlacement === 'tail') {
        messages.splice(messages.indexOf(current), 1);
        messages.push(current);
      }
    },
    update({ context, changes }) {
      replace(context);
      messages.push({ role: 'user', content: `Observation refreshed: ${changes.join('; ')}. Reconsider affected intentions using its current facts.` });
    },
    result(call, result) {
      let retained = result;
      if (call.function.name === 'get_context' && result.citizen && Number.isFinite(result.tick)) {
        replace(result);
        retained = { refreshed: true, tick: result.tick, observation: 'Use the current observation snapshot in this request.' };
      } else if (result.context) {
        const { context, ...receipt } = result;
        replace(context);
        retained = { ...receipt, observation: 'Use the current observation snapshot to reconsider this error.' };
      }
      // Exact repeated read queries supersede their earlier answer. Different
      // queries, and every state-changing receipt, remain available.
      if (/^(get_|find_)/.test(call.function.name) || call.function.name === 'inspect') {
        const key = `${call.function.name}:${call.function.arguments}`;
        const previous = queries.get(key);
        if (previous) previous.content = JSON.stringify({ superseded: true, byCallId: call.id });
        const message = { role: 'tool', tool_call_id: call.id, content: JSON.stringify(retained) };
        messages.push(message);
        queries.set(key, message);
      } else messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(retained) });
    },
  };
}
