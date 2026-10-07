// Follow recorded axis-aligned steps, including corners and faster footwear.
// Never predict a route or interpolate through an unrecorded jump.
export function createMotionClock() {
  let latest = null, displayed = 0, at = null, running = false, speed = 1;
  const lag = rate => Math.max(1, rate * .5);
  const sample = now => {
    if (at === null) return displayed;
    const elapsed = Math.max(0, now - at) / 1000;
    at = Math.max(at, now);
    if (!running) return displayed;
    // A resumed background tab may have missed the retained path. Restart near
    // current truth instead of replaying minutes or predicting unknown movement.
    if (elapsed > 2) displayed = Math.max(displayed, latest - lag(speed));
    else displayed = Math.min(latest, displayed + elapsed * speed);
    return displayed;
  };
  return {
    sample,
    receive(tick, nextRunning, nextSpeed, now) {
      sample(now);
      if (latest === null || tick < latest) displayed = Math.max(0, tick - (nextRunning ? lag(nextSpeed) : 0));
      else if (!nextRunning) displayed = tick;
      latest = tick; running = nextRunning; speed = nextSpeed; at = now;
    },
  };
}

export function sampleMotion(points, tick, fallback) {
  if (!Array.isArray(points) || !points.length) return fallback;
  if (tick <= points[0].tick) return points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (tick > b.tick) continue;
    const duration = b.tick - a.tick;
    if (duration <= 0 || Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 1) return tick >= b.tick ? b : a;
    const weight = Math.max(0, Math.min(1, (tick - a.tick) / duration));
    return { x: a.x + (b.x - a.x) * weight, y: a.y + (b.y - a.y) * weight };
  }
  return points.at(-1);
}
