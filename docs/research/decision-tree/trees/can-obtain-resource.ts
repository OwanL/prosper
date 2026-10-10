import type { DraftTree } from '../draft-types.ts';

// Descriptive proposed design only; no engine execution. Combat evidence requires
// proposed local visible carried inventories (currently unknown), or public sell
// evidence of exact-tier transferable stock. No proposed ground-loot route.
export const canObtainResource = {
  name: 'CanObtainResource',
  kind: 'condition',
  document: 'trees/can-obtain-resource.md',
  entry: 'Start',
  nodes: {
    Start: {
      kind: 'step',
      operation: 'entry',
      label:
        'Can obtain one additional exact-tier unit?<br/>Context: ResourceRequest(kind food | fibre | wood, tier, allowMarket), purpose',
      next: 'Enumerate',
    },
    Enumerate: {
      kind: 'resourcePlan',
      operation: 'enumerateKnownRoutes',
      label:
        'Pure enumeration of known feasible exact-tier plans:<br/>capabilities, survival, hard permissions and all prerequisites;<br/>preserve existing requested-tier stock and caller-protected inputs;<br/>allowMarket applies to the entire plan, including preparation and funding',
      next: 'Harvest',
    },
    Harvest: {
      kind: 'decision',
      label: 'Known feasible harvest route producing the requested tier?',
      yes: 'True',
      no: 'Refinement',
    },
    Refinement: {
      kind: 'decision',
      label: 'Known feasible refinement route with exact inputs and usable station?',
      yes: 'True',
      no: 'Salvage',
    },
    Salvage: {
      kind: 'decision',
      label:
        'Known feasible building-material salvage route?<br/>Exact-tier wood or fibre only; never food stock',
      yes: 'True',
      no: 'Combat',
    },
    Combat: {
      kind: 'decision',
      label:
        'Observed exact-tier citizen stock and viable combat transfer?<br/>Target evidence, survival and hard permissions satisfied',
      yes: 'True',
      no: 'MarketAllowed',
    },
    MarketAllowed: {
      kind: 'decision',
      label: 'allowMarket?',
      yes: 'Market',
      no: 'False',
    },
    Market: {
      kind: 'decision',
      label:
        'Funded credible exact-tier market route?<br/>Executable supply plus feasible funding, or recover own requested sell escrow;<br/>a postable bid alone is not supply',
      yes: 'True',
      no: 'False',
    },
    True: { kind: 'boolean', value: true },
    False: { kind: 'boolean', value: false },
  },
} as const satisfies DraftTree;
