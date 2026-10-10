import type { DraftTree } from '../draft-types.ts';

// Descriptive planning data transcribed from the Mermaid graphs, not executable
// mechanics or assertions about the implemented market.
export const obtainFoodNow = {
  name: 'ObtainFoodNow',
  kind: 'foodAction',
  document: 'trees/obtain-food-now.md',
  entry: 'Start',
  nodes: {
    Start: { kind: 'step', operation: 'entry', label: 'Obtain food now', next: 'OwnFoodOrders' },
    OwnFoodOrders: {
      kind: 'decision',
      label: 'Do we have a sell order holding food?',
      yes: 'CancelFood',
      no: 'EnoughGold',
    },
    CancelFood: {
      kind: 'food',
      action: 'cancelFoodSellOrder',
      label: 'Cancel a qualifying own food sell order<br/>and actually recover food',
    },
    EnoughGold: {
      kind: 'decision',
      label: 'Do we have enough gold for the cheapest food?',
      yes: 'BuyFood',
      no: 'Select',
    },
    BuyFood: {
      kind: 'food',
      action: 'buyFood',
      label: 'Buy one food at the cheapest available price<br/>and actually receive food',
    },
    Select: {
      kind: 'step',
      operation: 'selectFundingCombination',
      label:
        'Choose a utility-weighted funding COMBINATION covering the shortfall:<br/>own buy-order refunds + carried-item sales + non-food sell-escrow recovery/resale;<br/>compare retention loss, gold utility and cancellation opportunity costs<br/>using actual remaining escrow, current bid prices and quantities',
      next: 'Valid',
    },
    Valid: {
      kind: 'decision',
      label: 'Valid funding combination selected?',
      yes: 'Refunds',
      no: 'Error',
    },
    Error: {
      kind: 'error',
      label: 'ERROR: violated precondition or failed acquisition execution',
    },
    Refunds: {
      kind: 'decision',
      label: 'Cancel buy orders in selected combination?',
      yes: 'CancelBuy',
      no: 'Recover',
    },
    CancelBuy: {
      kind: 'funding',
      action: 'cancelBuyOrders',
      label: 'Cancel selected own buy orders',
      next: 'GoldAfterRefunds',
    },
    GoldAfterRefunds: {
      kind: 'decision',
      label: 'Enough gold for food now?',
      yes: 'BuyFood',
      no: 'Recover',
    },
    Recover: {
      kind: 'decision',
      label: 'Recover non-food sell escrow in selected combination?',
      yes: 'CancelSell',
      no: 'Sales',
    },
    CancelSell: {
      kind: 'funding',
      action: 'cancelNonFoodSellOrders',
      label: 'Cancel selected own non-food sell orders',
      next: 'GoldAfterRecovery',
    },
    GoldAfterRecovery: {
      kind: 'decision',
      label: 'Enough gold for food now?',
      yes: 'BuyFood',
      no: 'Sales',
    },
    Sales: {
      kind: 'decision',
      label: 'Sell items in selected combination?',
      yes: 'SellItem',
      no: 'BuyFood',
    },
    SellItem: {
      kind: 'funding',
      action: 'sellItems',
      label: 'Sell selected quantities to current matching bids',
      next: 'BuyFood',
    },
  },
} as const satisfies DraftTree;
