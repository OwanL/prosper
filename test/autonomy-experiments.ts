import { createWorld, tickWorld } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { foodRunway } from '../src/world/autonomy.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { World } from '../src/shared/types.ts';

const population=Number(process.argv[2]??6),ticks=Number(process.argv[3]??6000),seeds=(process.argv[4]??'1,2,42').split(',').map(Number);
mkdirSync('.experiments/world-ai',{recursive:true});
for(const seed of seeds) {
  const world:World=process.argv[6]?JSON.parse(readFileSync(process.argv[6],'utf8')):createWorld({seed,autonomy:true,population});
  const startTick=world.tick;
  const tag=process.argv[5]?.replace(/[^a-zA-Z0-9-]/g,'');
  const prefix=`.experiments/world-ai/world-ai-${population}-${seed}${tag?`-${tag}`:''}`;
  const events:typeof world.events=[];
  const kinds:Record<string,number>={};
  const retain=new Set(['death','birth','attack','claim','threat','extortion','alliance','flee','trade','error','help']);
  const timeline:unknown[]=[];
  updateKnowledge(world);
  const start=performance.now();
  let capturedConflict=false;
  while(world.tick<ticks) {
    tickWorld(world);updateKnowledge(world);
    for(const entry of world.events.filter((entry)=>entry.tick===world.tick)) {
      kinds[entry.kind]=(kinds[entry.kind]??0)+1;
      if(retain.has(entry.kind))events.push(entry);
    }
    if(!capturedConflict&&world.events.some((entry)=>entry.tick===world.tick&&entry.kind==='attack')) {
      writeFileSync(`${prefix}-conflict-snapshot.json`,JSON.stringify(world));
      capturedConflict=true;
    }
    // Tool holdings are included in the final carried inventory report.
    if(world.tick%500===0)timeline.push({tick:world.tick,alive:Object.values(world.citizens).filter((c)=>c.alive).length,claims:Object.keys(world.claims??{}).length,alliances:Object.values(world.alliances??{}).map((a)=>a.members.length),citizens:Object.values(world.citizens).filter((c)=>c.alive).map((c)=>({name:c.name,pos:[c.x,c.y],food:Math.round(foodRunway(c)),gold:c.gold,intent:c.autonomy?.intent}))});
    if(world.tick%1000===0)console.log(JSON.stringify({progress:true,seed,tick:world.tick,alive:Object.values(world.citizens).filter((c)=>c.alive).length,elapsedMs:Math.round(performance.now()-start),rssMB:Math.round(process.memoryUsage().rss/1e6),births:events.filter((e)=>e.kind==='birth').length,deaths:events.filter((e)=>e.kind==='death').length,fills:events.filter((e)=>e.kind==='trade').length,attacks:events.filter((e)=>e.kind==='attack').length}));
    if(performance.now()-start>600000||Object.values(world.citizens).filter((c)=>c.alive).length>500) {console.log('Experiment stopped at safety bound; report records actual horizon.');break;}
  }
  const report={seed,population,startTick,ticks:world.tick,ms:Math.round(performance.now()-start),kinds,timeline,events,citizens:Object.values(world.citizens).map((c)=>({id:c.id,name:c.name,alive:c.alive,health:c.health,position:[c.x,c.y],gold:c.gold,inventory:c.inventory,autonomy:c.autonomy})),gold:Object.values(world.citizens).reduce((s,c)=>s+c.gold,0)+Object.values(world.orders).reduce((s,o)=>s+o.escrowGold,0)+Object.values(world.loot).reduce((s,l)=>s+l.gold,0)};
  writeFileSync(`${prefix}.json`,JSON.stringify(report,null,2));
  writeFileSync(`${prefix}-snapshot.json`,JSON.stringify(world));
  console.log(JSON.stringify({seed,population,ticks:report.ticks,ms:report.ms,kinds,gold:report.gold,alive:report.citizens.filter((c)=>c.alive).length}));
}
