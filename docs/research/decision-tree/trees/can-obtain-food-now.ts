import type { DraftTree } from '../draft-types.ts';

// Descriptive planning data transcribed from the Mermaid graphs, not executable
// mechanics or assertions about the implemented market.
export const canObtainFoodNow = {
  name: 'CanObtainFoodNow',
  kind: 'condition',
  document: 'trees/can-obtain-food-now.md',
  entry: 'Start',
  nodes: {
    Start: {
      kind: 'step',
      operation: 'entry',
      label: 'Can obtain food now',
      next: 'OwnFoodOrders',
    },
    OwnFoodOrders: {
      kind: 'decision',
      label: 'Do we have sell orders for food?',
      yes: 'True',
      no: 'FoodForSale',
    },
    True: { kind: 'boolean', value: true },
    FoodForSale: {
      kind: 'decision',
      label: 'Is another citizen selling food?',
      yes: 'EnoughGold',
      no: 'False',
    },
    False: { kind: 'boolean', value: false },
    EnoughGold: {
      kind: 'decision',
      label: 'Do we have enough gold for the cheapest food?',
      yes: 'True',
      no: 'Shortfall',
    },
    Shortfall: {
      kind: 'step',
      operation: 'calculateShortfall',
      label: 'Shortfall = cheapest food price - gold',
      next: 'CancelBuys',
    },
    CancelBuys: {
      kind: 'decision',
      label: 'Would cancelling our buy orders refund >= shortfall?',
      yes: 'True',
      no: 'SellInventory',
    },
    SellInventory: {
      kind: 'decision',
      label: 'Refunds + selling inventory to buy orders >= shortfall?',
      yes: 'True',
      no: 'CancelSells',
    },
    CancelSells: {
      kind: 'decision',
      label:
        'Refunds + inventory sales + cancelling our item sell orders<br/>and selling those items to buy orders >= shortfall?',
      yes: 'True',
      no: 'False',
    },
  },
} as const satisfies DraftTree;
