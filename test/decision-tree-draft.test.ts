import { describe, expect, it } from 'vitest';
import { canObtainFoodNow } from '../docs/research/decision-tree/trees/can-obtain-food-now.ts';
import { obtainFoodNow } from '../docs/research/decision-tree/trees/obtain-food-now.ts';
import type { DraftTree } from '../docs/research/decision-tree/draft-types.ts';
import {
  renderMermaid,
  updateDiagram,
  validateTree,
} from '../docs/research/decision-tree/render.ts';

const foodTrees = [canObtainFoodNow, obtainFoodNow] as const;
const clone = (tree: DraftTree) => structuredClone(tree) as DraftTree;

// Trace the declared edges with supplied choices, not implemented market behavior.
function traceFoodRoute(choices: Record<string, boolean>) {
  const tree: DraftTree = obtainFoodNow;
  const decisions: Record<string, boolean> = {
    GoldAfterRefunds: false,
    GoldAfterRecovery: false,
    ...choices,
  };
  const steps: string[] = [];
  let id = tree.entry;
  for (let count = 0; count < Object.keys(tree.nodes).length; count++) {
    const node = tree.nodes[id];
    if (node.kind === 'decision') id = decisions[id] ? node.yes : node.no;
    else if (node.kind === 'step' || node.kind === 'funding') {
      if (node.kind === 'funding') steps.push(id);
      id = node.next;
    } else break;
  }
  return { steps, terminal: id, kind: tree.nodes[id].kind };
}

describe('decision-tree drafts', () => {
  it('validates both current graphs and renders only their intended terminals', () => {
    for (const tree of foodTrees) expect(() => validateTree(tree)).not.toThrow();
    const [condition, action] = foodTrees;
    expect(
      Object.values(action.nodes)
        .filter((node) => node.kind === 'food')
        .map((node) => node.action)
        .sort(),
    ).toEqual(['buyFood', 'cancelFoodSellOrder']);
    expect(Object.values(action.nodes).filter((node) => node.kind === 'error')).toHaveLength(1);
    expect(
      Object.values(condition.nodes)
        .filter((node) => node.kind === 'boolean')
        .map((node) => node.value)
        .sort(),
    ).toEqual([false, true]);
    expect(renderMermaid(action).match(/^\s+\w+\(\[".*"\]\)$/gm)).toEqual([
      '    CancelFood(["Cancel a qualifying own food sell order<br/>and actually recover food"])',
      '    BuyFood(["Buy one food at the cheapest available price<br/>and actually receive food"])',
      '    Error(["ERROR: violated precondition or failed acquisition execution"])',
    ]);
    expect(renderMermaid(condition).match(/^\s+\w+\(\[".*"\]\)$/gm)).toEqual([
      '    True(["True"])',
      '    False(["False"])',
    ]);
  });

  it('rejects dangling funding continuations, cycles and unreachable nodes', () => {
    const dangling = clone(foodTrees[1]);
    Reflect.deleteProperty(dangling.nodes.CancelBuy, 'next');
    expect(() => validateTree(dangling)).toThrow(/missing continuation/);
    const cycle = clone(foodTrees[0]);
    cycle.nodes.Start = { kind: 'step', operation: 'entry', label: 'Start', next: 'Start' };
    expect(() => validateTree(cycle)).toThrow(/cycle/);
    const unreachable = clone(foodTrees[0]);
    unreachable.nodes.Orphan = { kind: 'boolean', value: true };
    expect(() => validateTree(unreachable)).toThrow(/unreachable node Orphan/);
  });

  it('rejects boolean completion in action trees and food or funding in conditions', () => {
    const action = clone(foodTrees[1]);
    action.nodes.BuyFood = { kind: 'boolean', value: true };
    expect(() => validateTree(action)).toThrow(/non-action success terminal/);
    for (const node of [
      { kind: 'food', action: 'buyFood', label: 'food' } as const,
      { kind: 'funding', action: 'sellItems', label: 'funding', next: 'True' } as const,
    ]) {
      const condition = clone(foodTrees[0]);
      condition.nodes.Start = node;
      expect(() => validateTree(condition)).toThrow(/condition contains an action/);
    }
  });

  it.each([
    ['direct buy', false, true, false, false, false, [], 'BuyFood'],
    ['food escrow', true, false, false, false, false, [], 'CancelFood'],
    ['refund only', false, false, true, false, false, ['CancelBuy'], 'BuyFood'],
    ['inventory sale', false, false, false, false, true, ['SellItem'], 'BuyFood'],
    ['recover and sell', false, false, false, true, true, ['CancelSell', 'SellItem'], 'BuyFood'],
    [
      'mixed funding',
      false,
      false,
      true,
      true,
      true,
      ['CancelBuy', 'CancelSell', 'SellItem'],
      'BuyFood',
    ],
  ] as const)(
    '%s ends in food after the expected intermediate steps',
    (_, ownFood, gold, refunds, recover, sales, expectedSteps, terminal) => {
      expect(
        traceFoodRoute({
          OwnFoodOrders: ownFood,
          EnoughGold: gold,
          Valid: true,
          Refunds: refunds,
          Recover: recover,
          Sales: sales,
        }),
      ).toEqual({ steps: expectedSteps, terminal, kind: 'food' });
    },
  );

  it.each([
    ['refunds', true, false, ['CancelBuy']],
    ['escrow recovery', false, true, ['CancelBuy', 'CancelSell']],
  ] as const)(
    'skips remaining selected funding when food becomes affordable after %s',
    (_, afterRefunds, afterRecovery, steps) => {
      expect(
        traceFoodRoute({
          OwnFoodOrders: false,
          EnoughGold: false,
          Valid: true,
          Refunds: true,
          Recover: true,
          Sales: true,
          GoldAfterRefunds: afterRefunds,
          GoldAfterRecovery: afterRecovery,
        }),
      ).toEqual({ steps, terminal: 'BuyFood', kind: 'food' });
    },
  );

  it('replaces exactly one diagram fence, preserving prose deterministically', () => {
    const tree = foodTrees[0];
    const prose = `Before the graph.\n\n\`\`\`mermaid\nold graph\n\`\`\`\n\nAfter the graph.`;
    const updated = updateDiagram(prose, tree);
    expect(updated).toBe(
      `Before the graph.\n\n\`\`\`mermaid\n${renderMermaid(tree)}\n\`\`\`\n\nAfter the graph.`,
    );
    expect(updateDiagram(updated, tree)).toBe(updated);
    expect(() => updateDiagram('no diagram', tree)).toThrow(/exactly one Mermaid diagram/);
    expect(() => updateDiagram(`${prose}\n\n\`\`\`mermaid\nsecond\n\`\`\``, tree)).toThrow(
      /exactly one Mermaid diagram/,
    );
  });
});
