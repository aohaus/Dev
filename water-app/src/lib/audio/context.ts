"use client";

interface AudioHandles {
  ctx: AudioContext;
  master: GainNode;
}

let handlesPromise: Promise<AudioHandles> | null = null;

async function init(): Promise<AudioHandles> {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  await ctx.audioWorklet.addModule("/worklets/white-noise-processor.js");
  return { ctx, master };
}

// Must be called from a user gesture (tap) so the browser allows the
// AudioContext to start and, on iOS, to keep running once the tab backgrounds.
export async function ensureAudio(): Promise<AudioHandles> {
  if (!handlesPromise) handlesPromise = init();
  const handles = await handlesPromise;
  if (handles.ctx.state === "suspended") await handles.ctx.resume();
  return handles;
}

export function createNoiseNode(ctx: AudioContext): AudioWorkletNode {
  return new AudioWorkletNode(ctx, "white-noise-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
}
