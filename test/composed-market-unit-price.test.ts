import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observeDecision, updateKnowledge } from '../src/world/observation.ts';
import { effortPrice, quotePrice } from '../src/citizen/tree-market.ts';
import type { ItemKey } from '../src/shared/types.ts';

describe('personal trade-event unit-price evidence', () => {
  for (const item of ['wood:1', 'wood:2'] as ItemKey[]) {
    for (const quantity of [0.2, 2]) {
      it(`prices ${quantity} ${item} from the actual unit execution price after complete settlement`, () => {
        const world = createWorld({ seed: 7, population: 3, controllerMode: 'composed', autonomy: false });
        const [seller, buyer, outsider] = Object.values(world.citizens);
        seller.inventory = { [item]: quantity };
        buyer.inventory = {};
        buyer.gold = 100;
        const dispositions = seller.mind!.dispositions;
        for (const key of Object.keys(dispositions))
          dispositions[key as keyof typeof dispositions] = 0.5;
        const initialGold = seller.gold;
        expect(dispatch(world, seller.id, { type: 'order', side: 'sell', item, quantity, price: 10 }).ok).toBe(true);
        expect(dispatch(world, buyer.id, { type: 'order', side: 'buy', item, quantity, price: 12 }).ok).toBe(true);
        expect(world.orders).toEqual({});
        const actualUnitPrice = (seller.gold - initialGold) / quantity;
        expect(actualUnitPrice).toBeCloseTo(10);
        updateKnowledge(world);
        const observation = observeDecision(world, seller.id);
        const trades = observation.alerts.filter(event => event.kind === 'trade');
        expect(trades).toHaveLength(1);
        expect(trades[0].text).toBe(`${quantity} ${item} sold for 10 gold each.`);
        expect(trades[0].trade?.price).toBe(actualUnitPrice);
        expect(observation.markets).toEqual([]);
        expect(observeDecision(world, outsider.id).alerts.filter(event => event.kind === 'trade')).toEqual([]);
        // Neutral dispositions give preference 1: the unchanged policy weights
        // personal effort at 60% and the observed unit execution price at 40%.
        const expected = Math.max(1, Math.min(100, Math.round(effortPrice(item) * 0.6 + actualUnitPrice * 0.4)));
        expect(quotePrice(observation, item)).toBe(expected);
        expect(quotePrice(observation, item)).toBe(quotePrice(observation, item));
      });
    }
  }
});
