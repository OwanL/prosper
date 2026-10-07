import { strategyPrompt } from './undertaking.mjs';

// Choose projects freely; continuity concerns execution, not preferred outcomes.
export function continuityPrompt(base) {
  const prompt = strategyPrompt(base)
    .replace('Make tasks/work implement intended actions.', 'Keep useful projects through interruptions; revise when evidence warrants.')
    .replace('Plans replace 0-4 serial tasks, then repeat work.', 'mode:"continue" preserves work/progress/queue; omit tasks/work or echo unchanged. mode:"replace" replaces 0-4 tasks then work, losing progress. Either allows notes/communications.')
    .replace('Return JSON:', 'Return JSON: mode continue|replace (default replace);');
  const example = JSON.parse(prompt.split('\n').at(-1));
  example.mode = 'replace';
  return prompt.replace(/\n\{[^\n]*\}$/, '\n' + JSON.stringify(example));
}
