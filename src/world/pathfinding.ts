import type { Citizen, Point, World } from '../shared/types.ts';

export function inBounds(world: Pick<World, 'width' | 'height'>, point: Point): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < world.width &&
    point.y < world.height
  );
}
export function walkable(world: World, point: Point): boolean {
  return (
    inBounds(world, point) &&
    !Object.values(world.buildings).some(
      (b) => b.kind === 'wall' && b.x === point.x && b.y === point.y,
    )
  );
}
// Stable tie-breaking: east, north, west, south. Citizens and stations do not block.
export function neighbors(point: Point): Point[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y - 1 },
  ];
}

/** Shortest orthogonal route, excluding start and including destination. */
export function findPath(world: World, start: Point, destination: Point): Point[] | null {
  if (!inBounds(world, start) || !walkable(world, destination)) return null;
  const walls=new Set(Object.values(world.buildings).filter((b)=>b.kind==='wall').map((b)=>`${b.x},${b.y}`));
  const noGo=(start as Partial<Citizen>).autonomy?.policy.noGo??[];
  const forbidden=(point:Point)=>noGo.some((area)=>point.x>=area[0]&&point.y>=area[1]&&point.x<=area[2]&&point.y<=area[3]);
  if(forbidden(destination))return null;
  if(forbidden(start)) {
    // A revised border may encompass a citizen. Permit only the shortest exit
    // through the regions already containing them, then resume hard exclusion.
    const enclosing=noGo.filter((area)=>start.x>=area[0]&&start.y>=area[1]&&start.x<=area[2]&&start.y<=area[3]);
    const other=noGo.filter((area)=>!enclosing.includes(area));
    const address=(p:Point)=>`${p.x},${p.y}`;
    const frontier:Point[][]=[[{x:start.x,y:start.y}]],seen=new Set([address(start)]);
    let minimum=Infinity;
    const exits:Point[][]=[];
    for(let i=0;i<frontier.length;i++) {
      const path=frontier[i],point=path.at(-1)!;
      if(path.length>minimum)break;
      if(!forbidden(point)) {minimum=path.length;exits.push(path);continue;}
      for(const next of neighbors(point)) {
        if(!inBounds(world,next)||walls.has(address(next))||seen.has(address(next))||other.some((a)=>next.x>=a[0]&&next.y>=a[1]&&next.x<=a[2]&&next.y<=a[3]))continue;
        seen.add(address(next));frontier.push([...path,next]);
      }
    }
    exits.sort((a,b)=>Math.abs(a.at(-1)!.x-destination.x)+Math.abs(a.at(-1)!.y-destination.y)-Math.abs(b.at(-1)!.x-destination.x)-Math.abs(b.at(-1)!.y-destination.y));
    for(const exit of exits) {
      const safe=exit.at(-1)!;
      const rest=findPath(world,{...safe,autonomy:(start as Partial<Citizen>).autonomy} as Citizen,destination);
      if(rest)return [...exit.slice(1),...rest];
    }
    return null;
  }
  if(!walls.size) {
    const path:Point[]=[];
    const cursor={x:start.x,y:start.y};
    // The same stable east/north/west/south tie break as breadth-first search.
    for(const [axis,sign] of [['x',1],['y',1],['x',-1],['y',-1]] as const) while((destination[axis]-cursor[axis])*sign>0) {cursor[axis]+=sign;path.push({...cursor});}
    if(!path.some(forbidden))return path;
  }
  const key = (p: Point) => `${p.x},${p.y}`;
  const startKey = key(start),
    endKey = key(destination);
  const frontier: Point[] = [{ x: start.x, y: start.y }];
  const previous = new Map<string, Point | null>([[startKey, null]]);
  for (let cursor = 0; cursor < frontier.length; cursor++) {
    const point = frontier[cursor];
    if (key(point) === endKey) {
      const path: Point[] = [];
      let step = point;
      while (key(step) !== startKey) {
        path.push(step);
        step = previous.get(key(step))!;
      }
      return path.reverse();
    }
    for (const next of neighbors(point)) {
      if (!inBounds(world, next) || walls.has(key(next)) || forbidden(next) || previous.has(key(next))) continue;
      previous.set(key(next), point);
      frontier.push(next);
    }
  }
  return null;
}
