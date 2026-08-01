export interface SoundEngine {
  start(): void;
  stop(): void;
}

export type EngineFactory = (ctx: AudioContext, destination: AudioNode) => SoundEngine;
