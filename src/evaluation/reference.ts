import type { Command } from '../shared/types.ts';
import type { CandidateFactory } from './contracts.ts';

/** Privileged development comparator. Never supplied as an ordinary candidate or claimed optimal. */
export function developmentReference(kind: 'buy-meal' | 'sell-buy-meal'): CandidateFactory {
  const commands: Command[] = [
    ...(kind === 'sell-buy-meal' ? [{ type: 'order', side: 'sell', item: 'wood:1', quantity: 2, price: 2 } as Command] : []),
    { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 },
  ];
  return () => {
    let index = 0;
    return {
      metadata: { id: 'development-reference', version: '1', artifact: 'authored development trace v1', provenance: 'Privileged reference actions, not generic candidate capability', execution: 'cooperative-in-process' },
      reset() { index = 0; },
      decide(input) { const command = commands[index++]; return command ? { requestId: input.requestId, kind: 'command', command } : { requestId: input.requestId, kind: 'advance' }; },
      feedback() {}, close() {},
    };
  };
}
export const noCommandBaseline: CandidateFactory = () => ({
  metadata: { id: 'no-command', version: '1', artifact: 'always advance', provenance: 'Runner baseline; no inference', execution: 'cooperative-in-process' },
  reset() {}, decide(input) { return { requestId: input.requestId, kind: 'advance' }; }, feedback() {}, close() {},
});
