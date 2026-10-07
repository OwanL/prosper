// Experimental wording only: keep all names, parameter schemas and validators.
// The shared citizen instructions carry recurring execution/knowledge rules.
const descriptions = {
  get_context: 'Refresh within a tool batch; otherwise the observation updates automatically each step.',
  get_places: 'Known areas, ideal supply before travel/competition, and dated sightings; not guaranteed stock or a census.',
  find_resources: 'Five remembered sites ranked by uncertain ticks per unit, with yield and observation age. Optionally filter area; no remote live stock.',
  get_people: 'Living directory, dated sightings, visual condition, route and relationship; no private state. Up to12/page; after:nextAfter. Area filters remembered locations.',
  get_buildings: 'Dated known buildings: owner, area and route. Missing remote knowledge does not prove destruction.',
  get_exchanges: 'Actual eligible escrow and your closed offers. YOU pay want and receive give. Up to8/page; after:nextAfter. Preview may suffice.',
  get_history: 'Your outcomes and memories. publicQuery instead searches dated public speech: empty lists all; compass aliases;8/page, after:nextAfter. Claims enforce nothing.',
  get_mechanics: 'Exact costs, prerequisites and effects for an unfamiliar action.',
  send_private_message: 'Send now alongside work: free visibly nearby, otherwise1EXISTING wood. Returns actual ID/channel/cost. Attach only known reports; location reports your position. No goods transfer.',
  post_public_message: 'Post now for1existing wood. Public speech creates no goods, consent or contract.',
  open_offer: 'Escrow held goods now; returns REAL ID. One open offer/maker: replaceOfferId explicitly cancels/refunds it. YOU give giveAmount for wantAmount; zero is a gift. recipient restricts takers. trade routes to maker.',
  propose_family: 'Propose to an adult now; returns real proposal ID, requiring their acceptance. No goods or meeting. location reports your position.',
  accept_family: 'Accept a pending proposal addressed to you. Actual proposalId supplies consent for later reproduction, not a birth.',
  decline_family: 'Decline a pending proposal addressed to you by actual proposalId.',
  cancel_family: 'Cancel your active pairing/proposal by actual proposalId.',
  continue_strategy: 'Finish; RETAIN physical order, queue, work and invested effort. No tasks/work accepted. Optional notes/parallel communications. reviewAfter180..600, default600; events may review sooner.',
  commit_strategy: 'Finish; REPLACE unfinished physical execution with up to4 serial tasks then repeating work. Person interactions route automatically; no preparatory move. ensure_inventory minimum is TOTAL held stock, not extra units. Query mechanics for costs. To retain effort use continue_strategy. reviewAfter180..600, default600.',
};

export function briefToolMenu(tools) {
  return tools.map(definition => {
    const tool = structuredClone(definition);
    if (descriptions[tool.function.name]) tool.function.description = descriptions[tool.function.name];
    return tool;
  });
}
