import { expect, it } from 'vitest';
import { createWorld, dispatch, cancelAction, tickWorld } from '../src/world/core.ts';
import { advanceAutonomy, enableAutonomy } from '../src/world/autonomy.ts';
import { marketReserves } from '../src/world/market-intent.ts';

function fixture() {
  const world=createWorld({seed:7,population:2});world.deposits={};
  const [a,b]=Object.values(world.citizens);
  enableAutonomy(world,a,{livelihood:'wood',targetTier:1,reproduction:'avoid'});
  a.inventory={'food:1':20,'axe:1':1,'knife:1':1,'scythe:1':1};
  a.autonomy!.claimSuppressed=true;
  return {world,a,b};
}
it('prefers one highest carried livelihood tool while other copies remain saleable', () => {
  const { world, a } = fixture();
  a.inventory['axe:2'] = 2;
  const reserves = marketReserves(a);
  expect(reserves['axe:2']).toBe(1);
  expect(reserves['axe:1']).toBeUndefined();
  expect(reserves['knife:1']).toBeUndefined();
  expect(dispatch(world, a.id, { type: 'order', side: 'sell', item: 'axe:2', quantity: 2, price: 5 }).ok).toBe(true);
});

function turn({world,a}:ReturnType<typeof fixture>) {
  a.autonomy!.nextMarketTick=world.tick;a.autonomy!.nextThinkTick=world.tick;
  advanceAutonomy(world,a,{command:c=>dispatch(world,a.id,c),cancel:()=>cancelAction(world,a.id)});
  world.tick+=60;
}
it('rests funded bids without asks, bounds quotes and does not duplicate them',()=>{
  const f=fixture();for(let i=0;i<8;i++)turn(f);
  const bids=Object.values(f.world.orders).filter(o=>o.side==='buy');
  expect(bids.length).toBeGreaterThan(0);expect(bids.length).toBeLessThanOrEqual(3);
  expect(new Set(bids.map(o=>o.item)).size).toBe(bids.length);
  expect(bids.every(o=>o.quantity<=3&&o.escrowGold===o.quantity*o.price)).toBe(true);
  expect(f.a.gold).toBeGreaterThanOrEqual(24);
});
it('posts acquired unprotected inventory above its addressed acquisition receipt',()=>{
  const f=fixture();turn(f);
  const bid=Object.values(f.world.orders).find(o=>o.side==='buy'&&o.item==='fibre:1')!;
  expect(bid).toBeDefined();f.b.inventory[bid.item]=bid.quantity;
  expect(dispatch(f.world,f.b.id,{type:'order',side:'sell',item:bid.item,quantity:bid.quantity,price:bid.price}).ok).toBe(true);
  for(let i=0;i<6;i++)turn(f);
  const ask=Object.values(f.world.orders).find(o=>o.citizenId===f.a.id&&o.side==='sell'&&o.item===bid.item);
  expect(ask).toBeDefined();expect(ask!.price).toBeGreaterThan(bid.price);
});
it('keeps recipe deficits resting while physical production proceeds without asks',()=>{
  const f=fixture();f.a.autonomy!.policy.targetTier=2;
  f.world.deposits.wood={id:'wood',resource:'wood',tier:1,x:f.a.x,y:f.a.y,stock:30,capacity:30,regrowAt:0};
  expect(dispatch(f.world,f.a.id,{type:'harvest',depositId:'wood'}).ok).toBe(true);
  f.a.autonomy!.nextMarketTick=0;f.a.autonomy!.nextThinkTick=0;
  tickWorld(f.world);
  expect(Object.values(f.world.orders).some(o=>o.side==='buy'&&o.item.endsWith(':2'))).toBe(true);
  expect(f.a.action?.command.type).toBe('harvest');
});
it('does not confuse a distinct older purchase with the flipped item basis',()=>{
  const f=fixture();f.b.inventory['wood:1']=1;
  dispatch(f.world,f.b.id,{type:'order',side:'sell',item:'wood:1',quantity:1,price:12});
  dispatch(f.world,f.a.id,{type:'order',side:'buy',item:'wood:1',quantity:1,price:12});
  turn(f);const bid=Object.values(f.world.orders).find(o=>o.side==='buy'&&o.item==='fibre:1')!;
  f.b.inventory['fibre:1']=bid.quantity;
  dispatch(f.world,f.b.id,{type:'order',side:'sell',item:bid.item,quantity:bid.quantity,price:bid.price});
  for(let i=0;i<6;i++)turn(f);
  const ask=Object.values(f.world.orders).find(o=>o.side==='sell'&&o.item==='fibre:1')!;
  expect(ask.price).toBe(bid.price+1);expect(ask.price).toBeLessThan(12);
});
it('reclaims speculative escrow when food becomes critical',()=>{
  const f=fixture();for(let i=0;i<4;i++)turn(f);
  for(const o of Object.values(f.world.orders))if(o.side==='sell')dispatch(f.world,f.a.id,{type:'cancel-order',orderId:o.id});
  f.a.inventory={'axe:1':1};f.a.fullness=1;
  const gold=f.a.gold;turn(f);
  expect(f.a.gold).toBeGreaterThan(gold);
});
