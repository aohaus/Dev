"use client";

import { useEffect } from "react";

// Best effort only: telling the OS "this tab is playing media" is what
// gives Web Audio a chance to keep running after the screen locks on
// mobile browsers. It is not guaranteed inside every WebView (including
// World App's), since mini apps don't get a native background-audio
// session — there is no code-level fix for that.
export function useMediaSession(isPlaying: boolean, onStopAll: () => void) {
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Water",
      artist: "水 / 波 / 雨",
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      onStopAll();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      onStopAll();
    });

    return () => {
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("stop", null);
    };
  }, [onStopAll]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "none";
  }, [isPlaying]);
}
