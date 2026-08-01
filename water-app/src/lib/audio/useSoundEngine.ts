"use client";

import { useCallback, useRef, useState } from "react";
import { ensureAudio } from "./context";
import type { EngineFactory, SoundEngine } from "./types";

export function useSoundEngine(factory: EngineFactory, label: string) {
  const engineRef = useRef<SoundEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
      setIsPlaying(false);
      return;
    }
    setIsLoading(true);
    try {
      const { ctx, master } = await ensureAudio();
      const engine = factory(ctx, master);
      engine.start();
      engineRef.current = engine;
      setIsPlaying(true);
    } finally {
      setIsLoading(false);
    }
  }, [factory]);

  return { isPlaying, isLoading, toggle, label };
}
