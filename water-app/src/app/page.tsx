"use client";

import { useCallback } from "react";
import { SoundButton } from "@/components/SoundButton";
import { DonateButton } from "@/components/DonateButton";
import { DropIcon, WaveIcon, RainIcon } from "@/components/icons";
import { useSoundEngine } from "@/lib/audio/useSoundEngine";
import { useMediaSession } from "@/lib/audio/useMediaSession";
import { createWaterEngine } from "@/lib/audio/water";
import { createWavesEngine } from "@/lib/audio/waves";
import { createRainEngine } from "@/lib/audio/rain";

export default function Home() {
  const water = useSoundEngine(createWaterEngine, "水の流れる音");
  const waves = useSoundEngine(createWavesEngine, "穏やかな波の音");
  const rain = useSoundEngine(createRainEngine, "雨の音");

  const anyPlaying = water.isPlaying || waves.isPlaying || rain.isPlaying;

  const stopAll = useCallback(() => {
    if (water.isPlaying) water.toggle();
    if (waves.isPlaying) waves.toggle();
    if (rain.isPlaying) rain.toggle();
  }, [water, waves, rain]);

  useMediaSession(anyPlaying, stopAll);

  return (
    <main className="stage">
      <SoundButton
        icon={DropIcon}
        label="水の流れる音"
        isPlaying={water.isPlaying}
        isLoading={water.isLoading}
        onToggle={water.toggle}
      />
      <SoundButton
        icon={WaveIcon}
        label="穏やかな波の音"
        isPlaying={waves.isPlaying}
        isLoading={waves.isLoading}
        onToggle={waves.toggle}
      />
      <SoundButton
        icon={RainIcon}
        label="雨の音"
        isPlaying={rain.isPlaying}
        isLoading={rain.isLoading}
        onToggle={rain.toggle}
      />
      <DonateButton />
    </main>
  );
}
