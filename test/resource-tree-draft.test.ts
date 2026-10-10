import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canObtainResource } from '../docs/research/decision-tree/trees/can-obtain-resource.ts';
import { obtainResource } from '../docs/research/decision-tree/trees/obtain-resource.ts';
import type { DraftTree } from '../docs/research/decision-tree/draft-types.ts';
import {
  renderMermaid,
  updateDiagram,
  validateTree,
} from '../docs/research/decision-tree/render.ts';

const trees = [canObtainResource, obtainResource] as const;
const clone = (tree: DraftTree) => structuredClone(tree) as DraftTree;

// Follow only declared graph edges using supplied outcomes; this tests neither
// the runtime's policy nor the draft's route estimates.
function trace(outcomes: Record<string, boolean>) {
  const tree: DraftTree = obtainResource;
  const preparations: string[] = [];
  let id = tree.entry;
  for (let count = 0; count < Object.keys(tree.nodes).length; count++) {
    const node = tree.nodes[id];
    if (node.kind === 'decision') id = outcomes[id] ? node.yes : node.no;
    else if (node.kind === 'step' || node.kind === 'funding' || node.kind === 'resourcePlan')
      id = node.next;
    else if (node.kind === 'preparation') {
      preparations.push(id);
      id = node.next;
    } else return { preparations, terminal: id, kind: node.kind };
  }
  throw new Error('draft graph did not reach a terminal');
}

const route = (overrides: Record<string, boolean> = {}) =>
  trace({
    ExternalReceipt: false,
    Valid: true,
    Hybrid: false,
    MarketHybrid: true,
    Filled: false,
    NeedsPreparation: false,
    Purchase: false,
    MarketPurchase: true,
    RequestedEscrow: false,
    MarketEscrow: true,
    Harvest: false,
    Refine: false,
    Salvage: false,
    Combat: false,
    ...overrides,
  });

describe('resource decision-tree drafts', () => {
  it('validates both graphs and restricts action success to resource leaves plus one error', () => {
    for (const tree of trees) expect(() => validateTree(tree)).not.toThrow();
    const actionNodes: DraftTree['nodes'][string][] = Object.values(obtainResource.nodes);
    expect(actionNodes.filter((node) => node.kind === 'error')).toHaveLength(1);
    expect(actionNodes.filter((node) => node.kind === 'resource').length).toBeGreaterThan(0);
    expect(actionNodes.some((node) => node.kind === 'boolean' || node.kind === 'food')).toBe(false);
    expect(JSON.stringify(obtainResource)).not.toMatch(/groundLoot|equip/i);
  });

  it('rejects resource/preparation/select-cost operations in condition graphs', () => {
    for (const node of [
      { kind: 'resource', action: 'harvestResource', label: 'resource' },
      { kind: 'preparation', action: 'preparePrerequisites', label: 'prep', next: 'True' },
      { kind: 'resourcePlan', operation: 'estimateAndSelectRoute', label: 'cost', next: 'True' },
      { kind: 'step', operation: 'selectFundingCombination', label: 'cost', next: 'True' },
    ]) {
      const condition = clone(canObtainResource);
      condition.nodes.Start = node as DraftTree['nodes'][string];
      expect(() => validateTree(condition)).toThrow(/condition contains an action/);
    }
  });

  it('rejects boolean/food action terminals and missing continuation of the new preparation node', () => {
    for (const terminal of [
      { kind: 'boolean', value: true },
      { kind: 'food', action: 'buyFood', label: 'food' },
    ]) {
      const action = clone(obtainResource);
      action.nodes.ReceiveBuy = terminal as DraftTree['nodes'][string];
      expect(() => validateTree(action)).toThrow(/success terminal/);
    }
    const missingNext = clone(obtainResource);
    Reflect.deleteProperty(missingNext.nodes.PreparePrerequisites, 'next');
    expect(() => validateTree(missingNext)).toThrow(/missing continuation/);
  });

  it('traces supplied condition outcomes without treating market availability as physical supply', () => {
    const condition: DraftTree = canObtainResource;
    const follow = (outcomes: Record<string, boolean>) => {
      let id = condition.entry;
      for (let count = 0; count < Object.keys(condition.nodes).length; count++) {
        const node = condition.nodes[id];
        if (node.kind === 'decision') id = outcomes[id] ? node.yes : node.no;
        else if (node.kind === 'step' || node.kind === 'resourcePlan') id = node.next;
        else return node.kind === 'boolean' ? node.value : false;
      }
      throw new Error('condition graph did not reach a terminal');
    };
    expect(
      follow({
        Harvest: false,
        Refinement: false,
        Salvage: false,
        Combat: false,
        MarketAllowed: false,
        Market: true,
      }),
    ).toBe(false);
    expect(
      follow({
        Harvest: false,
        Refinement: false,
        Salvage: false,
        Combat: false,
        MarketAllowed: true,
        Market: false,
      }),
    ).toBe(false);
    expect(follow({ Harvest: true })).toBe(true);
  });

  it('uses one bounded dependency-ordered preparation phase with per-route market gates', () => {
    expect(JSON.stringify(obtainResource)).not.toMatch(
      /"NeedsTool"|"PrepareTool"|"NeedsStation"|"PrepareStation"|"PrepareInputs"/,
    );
    const nodes = obtainResource.nodes;
    expect(nodes.NeedsPreparation).toMatchObject({ yes: 'PreparePrerequisites', no: 'Purchase' });
    expect(nodes.PreparePrerequisites).toMatchObject({
      kind: 'preparation',
      action: 'preparePrerequisites',
      next: 'Purchase',
    });
    expect(nodes.Hybrid).toMatchObject({ yes: 'MarketHybrid', no: 'NeedsPreparation' });
    expect(nodes.Filled).toMatchObject({ yes: 'ReceiveBuy', no: 'NeedsPreparation' });
    for (const [gate, guarded] of [
      ['MarketHybrid', nodes.MarketHybrid.yes],
      ['MarketPurchase', nodes.MarketPurchase.yes],
      ['MarketEscrow', nodes.MarketEscrow.yes],
    ] as const) {
      expect(nodes[gate]).toMatchObject({ kind: 'decision', no: 'Error' });
      expect(guarded).toBe(
        gate === 'MarketHybrid'
          ? 'PostBuy'
          : gate === 'MarketPurchase'
            ? 'FundPurchase'
            : 'RecoverEscrow',
      );
    }
    expect(nodes.Purchase).toMatchObject({ yes: 'MarketPurchase', no: 'RequestedEscrow' });
    expect(nodes.RequestedEscrow).toMatchObject({ yes: 'MarketEscrow', no: 'Harvest' });
    expect(nodes.Refine).toMatchObject({ yes: 'MoveToStation', no: 'Salvage' });
    const prepLabel = nodes.PreparePrerequisites.label;
    expect(prepLabel).toMatch(/bounded/i);
    expect(prepLabel).toMatch(/no unbounded recursion/i);
    // The graph declares dependency ordering, not a universal station/tool order.
    expect(prepLabel).toContain('dependency-ordered');
    expect(prepLabel).toContain('follow actual input/tool/station dependencies');
    for (const [id, node] of Object.entries(nodes)) {
      if (node.kind === 'preparation' && node.action === 'moveToTarget') {
        expect(node.label, id).toContain('(skip if already at the target)');
      }
    }
  });

  it('follows action routes to the declared receipt leaf and records preparations', () => {
    expect(route({ Harvest: true })).toEqual({
      preparations: ['MoveToHarvest'],
      terminal: 'HarvestResource',
      kind: 'resource',
    });
    expect(route({ Purchase: true })).toEqual({
      preparations: ['FundPurchase'],
      terminal: 'PurchaseResource',
      kind: 'resource',
    });
    expect(route({ RequestedEscrow: true })).toEqual({
      preparations: [],
      terminal: 'RecoverEscrow',
      kind: 'resource',
    });
    for (const [choice, terminal, preparations] of [
      ['Refine', 'RefineResource', ['MoveToStation']],
      ['Salvage', 'SalvageResource', ['MoveToBuilding']],
      ['Combat', 'CombatTransfer', ['MoveToCitizen']],
    ] as const) {
      expect(route({ [choice]: true })).toEqual({ preparations, terminal, kind: 'resource' });
    }
    expect(route({ Refine: true, NeedsPreparation: true })).toEqual({
      preparations: ['PreparePrerequisites', 'MoveToStation'],
      terminal: 'RefineResource',
      kind: 'resource',
    });
    expect(route({ Hybrid: true, Filled: true })).toEqual({
      preparations: ['PostBuy'],
      terminal: 'ReceiveBuy',
      kind: 'resource',
    });
    expect(route({ Hybrid: true, Filled: false, Harvest: true })).toEqual({
      preparations: ['PostBuy', 'MoveToHarvest'],
      terminal: 'HarvestResource',
      kind: 'resource',
    });
    expect(route({ Hybrid: true, Filled: false, NeedsPreparation: true, Harvest: true })).toEqual({
      preparations: ['PostBuy', 'PreparePrerequisites', 'MoveToHarvest'],
      terminal: 'HarvestResource',
      kind: 'resource',
    });
    expect(route({ Valid: false, Purchase: true })).toEqual({
      preparations: [],
      terminal: 'Error',
      kind: 'error',
    });
    expect(route({ ExternalReceipt: true })).toEqual({
      preparations: [],
      terminal: 'ReceiveTransfer',
      kind: 'resource',
    });
    const harvest = route({ Harvest: true });
    for (const forbidden of ['PostBuy', 'FundPurchase']) {
      expect(harvest.preparations).not.toContain(forbidden);
    }
  });

  it('blocks erroneously selected market routes when the frozen request forbids market actions', () => {
    const selections: Record<string, boolean>[] = [
      { Purchase: true, Filled: false },
      { RequestedEscrow: true },
      { Hybrid: true, Filled: true },
    ];
    for (const selected of selections) {
      const result = route({
        ...selected,
        MarketHybrid: false,
        MarketPurchase: false,
        MarketEscrow: false,
      });
      expect(result).toEqual({ preparations: [], terminal: 'Error', kind: 'error' });
      for (const marketPrep of ['PostBuy', 'FundPurchase']) {
        expect(result.preparations).not.toContain(marketPrep);
      }
    }
  });

  it('keeps generated diagrams synchronized', () => {
    const directory = new URL('../docs/research/decision-tree/', import.meta.url);
    for (const tree of trees) {
      const current = readFileSync(new URL(tree.document, directory), 'utf8');
      expect(current.match(/```mermaid/g)?.length ?? 0).toBe(1);
      expect(() => updateDiagram('no diagram', tree)).toThrow(/exactly one Mermaid diagram/);
      expect(updateDiagram(current, tree)).toBe(current);
      expect(current).toContain(`\`\`\`mermaid\n${renderMermaid(tree)}\n\`\`\``);
    }
  });
});
