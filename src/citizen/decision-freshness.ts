import type { Citizen } from '../shared/types.ts';
import type { Directive, DirectiveState, StrategySpec } from '../shared/directive-types.ts';

/** Finished discrete outputs can make a repeated replacement obsolete. Gather/operate
 * quantities still mean NEW output, so ordinary productive progress is not stale. */
function outputKey(directive: Directive): string | undefined {
  if (directive.type === 'craft')
    return JSON.stringify([
      'craft',
      directive.item,
      directive.tier,
      directive.quantity ?? 1,
      directive.stopWhen ?? null,
    ]);
  if (directive.type === 'build')
    return JSON.stringify([
      'build',
      directive.kind,
      directive.tier,
      directive.x,
      directive.y,
      directive.stopWhen ?? null,
    ]);
  return undefined;
}

export function completedWorkFeedback(
  snapshot: DirectiveState | undefined,
  citizen: Citizen,
  spec: StrategySpec,
  observationTick: number,
) {
  if (!snapshot || snapshot.status !== 'active' || spec.mode === 'keep') return undefined;
  const repeated = new Set(
    (spec.directives ?? []).map(outputKey).filter((key) => key !== undefined),
  );
  const completed = snapshot.directives.flatMap((directive, index) => {
    const key = outputKey(directive);
    if (index < snapshot.index || key === undefined || !repeated.has(key)) return [];
    // Exact own completion receipts, not inventory guesses or remote inspection.
    // A chosen stop, cancellation, ingredient harvest or partial craft is not completion.
    const receipt = citizen.directiveReceipts?.find(
      (receipt) =>
        receipt.strategyId === snapshot.id &&
        receipt.index === index &&
        receipt.outcome === 'completed' &&
        receipt.tick > observationTick,
    );
    if (!receipt) return [];
    return [{ index, directive, completedTick: receipt.tick, message: receipt.message }];
  });
  if (!completed.length) return undefined;
  return {
    ok: false as const,
    code: 'work_state_changed',
    message:
      'Previously unfinished craft/build work completed during this request, and this decision repeats that output. Nothing in this strategy decision was applied. Reconsider the fresh completion evidence; keep the finished work or deliberately request additional output if that is still your intent. Existing work and committed effects remain.',
    strategyId: snapshot.id,
    completed,
    observationRefresh: 'next-request' as const,
  };
}
