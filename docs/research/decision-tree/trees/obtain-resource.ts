import type { DraftTree } from '../draft-types.ts';

// Stateless descriptive graph, not execution code. Request, concrete route,
// confirmed receipts and owned work/order handles live in explicit caller context.
// Route node IDs stay stable so other routes and traces are unaffected by the
// unified bounded preparation phase and the explicit market-permission gates.
export const obtainResource = {
  name: 'ObtainResource',
  kind: 'resourceAction',
  document: 'trees/obtain-resource.md',
  entry: 'Start',
  nodes: {
    Start: {
      kind: 'step',
      operation: 'entry',
      label:
        'Obtain one additional exact-tier unit<br/>Context: ResourceRequest(kind food | fibre | wood, tier, allowMarket), purpose',
      next: 'ExternalReceipt',
    },
    ExternalReceipt: {
      kind: 'decision',
      label: 'Confirmed new target unit from an incidental transfer?',
      yes: 'ReceiveTransfer',
      no: 'Enumerate',
    },
    ReceiveTransfer: {
      kind: 'resource',
      action: 'receiveExternalTransfer',
      label:
        'Receive the requested exact-tier unit from a confirmed external transfer;<br/>settle owned work/orders before handoff; never predict a natural death',
    },
    Enumerate: {
      kind: 'resourcePlan',
      operation: 'enumerateKnownRoutes',
      label:
        'Admit only fully-budgeted complete known plans and their prerequisites:<br/>harvest, refine, material salvage, evidenced combat, purchase, own sell escrow;<br/>protect the baseline and inherit survival, hard permissions and allowMarket<br/>for the whole candidate including its preparation and funding;<br/>never spend existing requested-tier stock or caller-protected inputs',
      next: 'Select',
    },
    Select: {
      kind: 'resourcePlan',
      operation: 'estimateAndSelectRoute',
      label:
        'Select and retain concrete target, path, bounded preparation sequence, inputs,<br/>tool/station and funding choices; compare travel + work + wait ETA,<br/>gold/material costs, residual recovery burden and risk,<br/>desperation, violence preference and ownership;<br/>hybrid needs funded bid + credible fully-budgeted physical fallback',
      next: 'Valid',
    },
    Valid: {
      kind: 'decision',
      label: 'Complete route respects permissions and protected stock?',
      yes: 'Hybrid',
      no: 'Error',
    },
    Hybrid: {
      kind: 'decision',
      label: 'Selected market-enabled hybrid?',
      yes: 'MarketHybrid',
      no: 'NeedsPreparation',
    },
    MarketHybrid: {
      kind: 'decision',
      label: 'Selected hybrid still MarketAllowed<br/>under the frozen request permissions?',
      yes: 'PostBuy',
      no: 'Error',
    },
    PostBuy: {
      kind: 'preparation',
      action: 'postBuyOrder',
      label:
        'Fund and post selected one-unit exact-tier bid;<br/>retain owned order handle, no delivery on acceptance',
      next: 'Filled',
    },
    Filled: {
      kind: 'decision',
      label: 'Confirmed requested receipt already delivered?',
      yes: 'ReceiveBuy',
      no: 'NeedsPreparation',
    },
    NeedsPreparation: {
      kind: 'decision',
      label:
        'Any selected-route prerequisite still unmet<br/>(station, tool, exact inputs, prerequisite travel/funding)?',
      yes: 'PreparePrerequisites',
      no: 'Purchase',
    },
    PreparePrerequisites: {
      kind: 'preparation',
      action: 'preparePrerequisites',
      label:
        'Execute the ONE selected bounded preparation sequence, dependency-ordered:<br/>follow actual input/tool/station dependencies, including needed travel/funding,<br/>under inherited permissions<br/>and protected stock; fixed plan from selection, no unbounded recursion,<br/>no mandatory tool/station build',
      next: 'Purchase',
    },
    Purchase: {
      kind: 'decision',
      label: 'Chosen route is purchase?',
      yes: 'MarketPurchase',
      no: 'RequestedEscrow',
    },
    MarketPurchase: {
      kind: 'decision',
      label: 'Selected purchase still MarketAllowed<br/>under the frozen request permissions?',
      yes: 'FundPurchase',
      no: 'Error',
    },
    FundPurchase: {
      kind: 'preparation',
      action: 'fundPurchase',
      label:
        'Execute selected funding only if needed; stop once affordable;<br/>gold or recovered non-target items alone do not complete the request',
      next: 'PurchaseResource',
    },
    PurchaseResource: {
      kind: 'resource',
      action: 'buyResource',
      label:
        'Buy the selected exact-tier resource and actually receive a filled unit;<br/>an accepted unfilled order is still in progress, not success',
    },
    ReceiveBuy: {
      kind: 'resource',
      action: 'receiveBuyFill',
      label:
        'Receive the requested additional exact-tier unit from an actual buy fill;<br/>resolve owned work/order before handoff',
    },
    RequestedEscrow: {
      kind: 'decision',
      label: 'Chosen route recovers requested own sell escrow?',
      yes: 'MarketEscrow',
      no: 'Harvest',
    },
    MarketEscrow: {
      kind: 'decision',
      label:
        'Selected escrow recovery still MarketAllowed<br/>under the frozen request permissions?',
      yes: 'RecoverEscrow',
      no: 'Error',
    },
    RecoverEscrow: {
      kind: 'resource',
      action: 'recoverRequestedSellEscrow',
      label:
        'Cancel selected requested listing and actually recover<br/>one additional exact-tier unit into available holdings',
    },
    Harvest: {
      kind: 'decision',
      label: 'Chosen route is harvest?',
      yes: 'MoveToHarvest',
      no: 'Refine',
    },
    MoveToHarvest: {
      kind: 'preparation',
      action: 'moveToTarget',
      label:
        'Travel selected known admissible path to harvest target<br/>(skip if already at the target)',
      next: 'HarvestResource',
    },
    HarvestResource: {
      kind: 'resource',
      action: 'harvestResource',
      label:
        'Harvest until confirmed delivery of the requested exact-tier unit;<br/>other-tier output or movement is not success',
    },
    Refine: {
      kind: 'decision',
      label: 'Chosen route is refinement?',
      yes: 'MoveToStation',
      no: 'Salvage',
    },
    MoveToStation: {
      kind: 'preparation',
      action: 'moveToTarget',
      label:
        'Travel selected admissible path to usable refinement station<br/>(skip if already at the target)',
      next: 'RefineResource',
    },
    RefineResource: {
      kind: 'resource',
      action: 'refineResource',
      label: 'Refine selected inputs and confirm additional requested exact-tier output',
    },
    Salvage: {
      kind: 'decision',
      label: 'Chosen route is building-material salvage?',
      yes: 'MoveToBuilding',
      no: 'Combat',
    },
    MoveToBuilding: {
      kind: 'preparation',
      action: 'moveToTarget',
      label:
        'Travel selected admissible path to evidenced material-yield building<br/>(skip if already at the target)',
      next: 'SalvageResource',
    },
    SalvageResource: {
      kind: 'resource',
      action: 'salvageResource',
      label:
        'Destroy the selected building and receive exact-tier wood or fibre salvage;<br/>damage/destruction without target delivery is not success; no food stock',
    },
    Combat: {
      kind: 'decision',
      label: 'Chosen route is evidenced viable combat transfer?',
      yes: 'MoveToCitizen',
      no: 'Error',
    },
    MoveToCitizen: {
      kind: 'preparation',
      action: 'moveToTarget',
      label:
        'Travel selected admissible path to exact-tier evidenced citizen target<br/>(skip if already at the target)',
      next: 'CombatTransfer',
    },
    CombatTransfer: {
      kind: 'resource',
      action: 'combatTransfer',
      label:
        'Defeat the selected citizen and receive the requested exact-tier item;<br/>attack or kill without requested delivery is not success',
    },
    Error: {
      kind: 'error',
      label:
        'ERROR: retained-context invalidated precondition, route, execution or timeout;<br/>settle ALL request-owned orders incl funding sells and stop owned work before handoff;<br/>keep ownership, frozen market permission and pending terminal state in cleanup Context;<br/>report feedback',
    },
  },
} as const satisfies DraftTree;
