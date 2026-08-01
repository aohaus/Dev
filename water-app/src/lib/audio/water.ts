import { createNoiseNode } from "./context";
import { randomWalk, scheduleSparse, type Cancel } from "./scheduler";
import type { SoundEngine } from "./types";

// A flowing stream: a filtered noise "body" whose resonant frequency
// wanders slowly, a brighter "sparkle" layer for trickling highlights,
// and a very occasional, very quiet distant bird call so it reads as an
// outdoor stream rather than a plumbing leak — without ever becoming a
// obvious, learnable loop.
export function createWaterEngine(ctx: AudioContext, destination: AudioNode): SoundEngine {
  let cancels: Cancel[] = [];
  let nodes: AudioNode[] = [];
  let running = false;

  function chirp(target: AudioNode) {
    const now = ctx.currentTime;
    const notes = Math.random() < 0.35 ? 2 : 1;
    for (let n = 0; n < notes; n++) {
      const start = now + n * (0.12 + Math.random() * 0.1);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const baseFreq = 2200 + Math.random() * 1200;
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq, start);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.4, start + 0.09);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(target);
      osc.start(start);
      osc.stop(start + 0.16);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
      engineGain.connect(destination);

      const noise = createNoiseNode(ctx);

      // Body: burbling mid-range resonance
      const body = ctx.createBiquadFilter();
      body.type = "bandpass";
      body.frequency.value = 700;
      body.Q.value = 1.4;
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.55;

      // Sparkle: brighter trickle highlights, quieter
      const sparkle = ctx.createBiquadFilter();
      sparkle.type = "bandpass";
      sparkle.frequency.value = 2600;
      sparkle.Q.value = 0.9;
      const sparkleGain = ctx.createGain();
      sparkleGain.gain.value = 0.12;

      // Low body warmth
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 500;
      const lowGain = ctx.createGain();
      lowGain.gain.value = 0.25;

      noise.connect(body).connect(bodyGain).connect(engineGain);
      noise.connect(sparkle).connect(sparkleGain).connect(engineGain);
      noise.connect(low).connect(lowGain).connect(engineGain);

      nodes = [engineGain, noise, body, bodyGain, sparkle, sparkleGain, low, lowGain];

      cancels = [
        randomWalk(ctx, body.frequency, { min: 450, max: 950, minSeconds: 6, maxSeconds: 14 }),
        randomWalk(ctx, sparkle.frequency, { min: 1800, max: 3400, minSeconds: 3, maxSeconds: 9 }),
        randomWalk(ctx, sparkleGain.gain, { min: 0.05, max: 0.2, minSeconds: 2, maxSeconds: 6 }),
        randomWalk(ctx, bodyGain.gain, { min: 0.45, max: 0.65, minSeconds: 4, maxSeconds: 10 }),
        scheduleSparse(45, 150, () => chirp(engineGain)),
      ];
    },
    stop() {
      if (!running) return;
      running = false;
      cancels.forEach((c) => c());
      cancels = [];
      const engineGain = nodes[0] as GainNode;
      const now = ctx.currentTime;
      engineGain.gain.cancelScheduledValues(now);
      engineGain.gain.setValueAtTime(engineGain.gain.value, now);
      engineGain.gain.linearRampToValueAtTime(0, now + 0.8);
      const toDisconnect = nodes;
      setTimeout(() => toDisconnect.forEach((n) => n.disconnect()), 900);
      nodes = [];
    },
  };
}
