// Small primitives for "never quite the same twice" motion: instead of
// periodic LFOs (which the ear learns fast), every step picks a random
// target and a random duration, so the rhythm itself never repeats.

export type Cancel = () => void;

export function randomWalk(
  ctx: AudioContext,
  param: AudioParam,
  opts: { min: number; max: number; minSeconds: number; maxSeconds: number }
): Cancel {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const step = () => {
    if (stopped) return;
    const target = opts.min + Math.random() * (opts.max - opts.min);
    const duration = opts.minSeconds + Math.random() * (opts.maxSeconds - opts.minSeconds);
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + duration);
    timeoutId = setTimeout(step, duration * 1000);
  };
  step();

  return () => {
    stopped = true;
    clearTimeout(timeoutId);
  };
}

export function scheduleSparse(
  minSeconds: number,
  maxSeconds: number,
  callback: () => void
): Cancel {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const tick = () => {
    if (stopped) return;
    const delay = (minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000;
    timeoutId = setTimeout(() => {
      if (stopped) return;
      callback();
      tick();
    }, delay);
  };
  tick();

  return () => {
    stopped = true;
    clearTimeout(timeoutId);
  };
}
