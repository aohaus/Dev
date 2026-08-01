import { createNoiseNode } from "./context";
import { scheduleSparse, type Cancel } from "./scheduler";
import type { SoundEngine } from "./types";

// Gentle shoreline waves: irregular swell-and-recede cycles (each one a
// different length and intensity, scheduled rather than looped), a brief
// foam-hiss at the peak of each swell, and a rare, quiet wind gust layered
// underneath so it reads as an open beach rather than a sealed room.
export function createWavesEngine(ctx: AudioContext, destination: AudioNode): SoundEngine {
  let cancels: Cancel[] = [];
  let nodes: AudioNode[] = [];
  let running = false;

  function scheduleSwell(bedGain: GainNode, foamGain: GainNode) {
    if (!running) return;
    const now = ctx.currentTime;
    const cycle = 7 + Math.random() * 7; // 7-14s per wave
    const peak = 0.55 + Math.random() * 0.35;
    const swellIn = cycle * (0.4 + Math.random() * 0.15);
    const swellOut = cycle - swellIn;

    bedGain.gain.cancelScheduledValues(now);
    bedGain.gain.setValueAtTime(bedGain.gain.value, now);
    bedGain.gain.linearRampToValueAtTime(peak, now + swellIn);
    bedGain.gain.linearRampToValueAtTime(0.18, now + cycle);

    const foamStart = now + swellIn - 0.4;
    const foamPeak = peak * (0.35 + Math.random() * 0.2);
    foamGain.gain.cancelScheduledValues(now);
    foamGain.gain.setValueAtTime(0.0001, foamStart);
    foamGain.gain.exponentialRampToValueAtTime(Math.max(foamPeak, 0.001), foamStart + 0.5);
    foamGain.gain.exponentialRampToValueAtTime(0.0001, foamStart + 0.5 + swellOut * 0.6);

    const timeoutId = setTimeout(() => scheduleSwell(bedGain, foamGain), cycle * 1000);
    cancels.push(() => clearTimeout(timeoutId));
  }

  function windGust(target: AudioNode) {
    const now = ctx.currentTime;
    const gustNoise = createNoiseNode(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 500 + Math.random() * 300;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    const duration = 4 + Math.random() * 4;
    const peak = 0.06 + Math.random() * 0.05;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + duration * 0.4);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    gustNoise.connect(filter).connect(gain).connect(target);
    setTimeout(() => {
      gustNoise.disconnect();
      filter.disconnect();
      gain.disconnect();
    }, duration * 1000 + 200);
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
      bed.type = "lowpass";
      bed.frequency.value = 650;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.2;

      const foam = ctx.createBiquadFilter();
      foam.type = "highpass";
      foam.frequency.value = 2200;
      const foamGain = ctx.createGain();
      foamGain.gain.value = 0.0001;

      noise.connect(bed).connect(bedGain).connect(engineGain);
      noise.connect(foam).connect(foamGain).connect(engineGain);

      nodes = [engineGain, noise, bed, bedGain, foam, foamGain];

      scheduleSwell(bedGain, foamGain);
      cancels.push(scheduleSparse(90, 240, () => windGust(engineGain)));
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
