"use client";

import type { ComponentType } from "react";

type SoundButtonProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isPlaying: boolean;
  isLoading: boolean;
  onToggle: () => void;
};

export function SoundButton({ icon: Icon, label, isPlaying, isLoading, onToggle }: SoundButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isPlaying}
      onClick={onToggle}
      disabled={isLoading}
      className={`sound-button${isPlaying ? " sound-button--active" : ""}`}
    >
      <span className="sound-button__ring" aria-hidden="true" />
      <Icon className="sound-button__icon" />
    </button>
  );
}
