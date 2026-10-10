import type { Directive } from './directive-types.ts';

/** Advisory only. Never infer a stop, reorder work or change the citizen's intent. */
export function sequencingWarnings(directives: readonly Directive[], index = 0): string[] {
  const warnings: string[] = [];
  for (let i = index; i < directives.length - 1; i++) {
    const directive = directives[i];
    if (
      (directive.type === 'gather' || directive.type === 'operate') &&
      directive.quantity === undefined &&
      directive.maxTicks === undefined &&
      directive.stopWhen === undefined
    ) {
      warnings.push(
        `Directive ${i + 1} (${directive.type}) is ongoing: later directives wait until you stop or replace it. reviewAfter does not finish it. Choose a quantity, maxTicks or stopWhen only if you want this predecessor to finish.`,
      );
    }
  }
  return warnings;
}

/** Public notation, not a disclosure of any unseen map contents. */
export const ASCII_LEGEND = {
  x: 'Outside current sight, NOT a wall or movement boundary; consult dated memories separately.',
  '#': 'Observed wall (structured building kind=wall).',
  '.': 'Currently visible empty tile.',
  '@': 'Citizen; entityIndex lists other entities sharing the tile.',
  B: 'Processing building.',
  L: 'Loot.',
  W: 'Wood deposit.',
  F: 'Food deposit.',
  V: 'Fibre deposit.',
} as const;
