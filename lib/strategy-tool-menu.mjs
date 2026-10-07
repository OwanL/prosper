// Experimental transport shape. The native continue/replace validators and
// execution semantics remain authoritative; no capability is removed.
export const STRATEGY_TOOL_NAMES = ['continue_strategy', 'commit_strategy', 'set_strategy'];

export function unifiedStrategyMenu(definitions) {
  const replace = definitions.find(t => t.function.name === 'commit_strategy');
  if (!replace || !definitions.some(t => t.function.name === 'continue_strategy')) throw new Error('Expected both native strategy tools.');
  const combined = structuredClone(replace);
  combined.function.name = 'set_strategy';
  combined.function.description = 'Finish this review. Supplying tasks or work replaces physical execution, discarding unfinished effort. Omitting both retains the order, queue, work and effort. Explicit mode:continue forbids tasks/work; mode:replace installs up to four serial tasks then repeating work. Both can revise notes and queue up to two parallel communications. Choose from current evidence; notes and promises do not execute.';
  combined.function.parameters.properties.mode = { type: 'string', enum: ['continue', 'replace'],
    description: 'Optional physical execution choice, independent of goals. Default replace when tasks/work is supplied, otherwise continue. Explicit continue forbids tasks/work.' };
  return definitions.filter(t => !STRATEGY_TOOL_NAMES.includes(t.function.name)).map(t => structuredClone(t)).concat(combined);
}

export function unifiedStrategyInstructions(instructions) {
  return instructions.replaceAll('continue_strategy', 'set_strategy(mode:continue)')
    .replaceAll('commit_strategy', 'set_strategy(mode:replace)');
}
