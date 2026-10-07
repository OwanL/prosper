// Bounded retrieval of published testimony. Search never reads private mail,
// live inventories, ownership enforcement or another citizen's private plans.
const compass = { ne: 'north east', nw: 'north west', se: 'south east', sw: 'south west' };
const words = text => String(text).toLowerCase()
  .replace(/\b(ne|nw|se|sw)\b/g, token => compass[token])
  .replace(/\b(north|south)[ -]?(east|west)\b/g, '$1 $2')
  .replace(/\bring[ -]?([12])\b/g, 'ring $1')
  .match(/[\p{L}\p{N}]+/gu) ?? [];

export function publicHistory(board, tick, { publicQuery, after, limit = 8 }) {
  const terms = words(publicQuery);
  const matches = [...board].reverse().filter(message => {
    const tokens = new Set(words(`${message.citizenId} ${message.name} ${message.text}`));
    return terms.every(term => tokens.has(term));
  });
  const cursor = after === undefined ? -1 : matches.findIndex(m => m.id === after);
  if (after !== undefined && cursor === -1) return { ok: false, error: 'Public notice cursor is no longer retained for this query. Start again without after.' };
  const remaining = matches.slice(cursor + 1), selected = remaining.slice(0, limit);
  return { scope: 'public', query: publicQuery, items: selected.map(m => ({ id: m.id, tick: m.tick, ageTicks: tick - m.tick,
    by: { id: m.citizenId, name: m.name }, text: m.text,
    ...(m.share ? { share: [...m.share] } : {}), ...(m.shareBuildings ? { shareBuildings: [...m.shareBuildings] } : {}) })),
    omitted: Math.max(0, remaining.length - selected.length), nextAfter: remaining.length > selected.length ? selected.at(-1).id : null,
    note: 'Published speech is dated testimony, not enforced ownership or proof that an offer remains open. Private mail is excluded.' };
}
