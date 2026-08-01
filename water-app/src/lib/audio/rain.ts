import { createNoiseNode } from "./context";
import { randomWalk, scheduleSparse, type Cancel } from "./scheduler";
import type { SoundEngine } from "./types";

// Steady rain hiss with a slowly wandering "intensity" (gusts of heavier
// or lighter rain) plus a rare, quiet, distant thunder rumble — kept low
// enough in both volume and frequency that it reads as texture, not an
// event that interrupts the relaxation.
export function createRainEngine(ctx: AudioContext, destination: AudioNode): SoundEngine {
  let cancels: Cancel[] = [];
  let nodes: AudioNode[] = [];
  let running = false;

  function thunder(target: AudioNode) {
    const now = ctx.currentTime;

    const crackNoise = createNoiseNode(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 700 + Math.random() * 900;
    crackFilter.Q.value = 0.8;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.05, now + 0.03);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    crackNoise.connect(crackFilter).connect(crackGain).connect(target);

    const rumbleNoise = createNoiseNode(ctx);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 120 + Math.random() * 100;
    const rumbleGain = ctx.createGain();
    const rumbleDuration = 4 + Math.random() * 3;
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.09, now + 0.4);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + rumbleDuration);
    rumbleNoise.connect(rumbleFilter).connect(rumbleGain).connect(target);

    const cleanupMs = rumbleDuration * 1000 + 300;
    setTimeout(() => {
      [crackNoise, crackFilter, crackGain, rumbleNoise, rumbleFilter, rumbleGain].forEach((n) =>
        n.disconnect()
      );
    }, cleanupMs);
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

      const bed = ctx.createBiquadFilter();
      bed.type = "highpass";
      bed.frequency.value = 1400;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.35;

      const body = ctx.createBiquadFilter();
      body.type = "bandpass";
      body.frequency.value = 3000;
      body.Q.value = 0.5;
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.2;

      noise.connect(bed).connect(bedGain).connect(engineGain);
      noise.connect(body).connect(bodyGain).connect(engineGain);

      nodes = [engineGain, noise, bed, bedGain, body, bodyGain];

      cancels = [
        randomWalk(ctx, bedGain.gain, { min: 0.25, max: 0.45, minSeconds: 3, maxSeconds: 8 }),
        randomWalk(ctx, bed.frequency, { min: 1100, max: 1800, minSeconds: 5, maxSeconds: 12 }),
        scheduleSparse(300, 900, () => thunder(engineGain)),
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
