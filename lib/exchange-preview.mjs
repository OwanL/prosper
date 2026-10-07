// Read-only retrieval of actual eligible escrow. This chooses facts to show,
// not trades to perform; counterparties and execution remain independent.
export function exchangePreview(context, limit = 4) {
  const referenced = new Set(context.inbox.flatMap(message => message.text.match(/\boffer-\d+\b/g) ?? []));
  const offers = context.offers.filter(offer => offer.makerId !== context.citizen.id)
    .sort((a, b) => Number(referenced.has(b.id)) - Number(referenced.has(a.id))
      || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { items: offers.slice(0, limit).map(offer => ({ id: offer.id, makerId: offer.makerId,
    directive: { type: 'trade', offer: offer.id },
    youPay: { resource: offer.want, amount: offer.wantAmount },
    youReceive: { resource: offer.give, amount: offer.giveAmount },
    expiresInTicks: Math.max(0, offer.expiresAt - context.tick) })),
    omitted: Math.max(0, offers.length - limit),
    note: 'Current eligible escrow: referenced offers first, then recent offers. No reservation; another citizen may fill one before arrival. get_exchanges returns further offers and your history.' };
}
