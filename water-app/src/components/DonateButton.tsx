"use client";

import { useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Tokens } from "@worldcoin/minikit-js/commands";
import { useMiniKit } from "@worldcoin/minikit-js/minikit-provider";
import { HeartIcon } from "./icons";

const DONATE_ADDRESS = process.env.NEXT_PUBLIC_DONATE_ADDRESS;

type Status = "idle" | "sending" | "sent";

export function DonateButton() {
  const { isInstalled } = useMiniKit();
  const [status, setStatus] = useState<Status>("idle");

  // Pay is a World App-only command; outside World App there is nothing
  // useful to show, so the button simply doesn't render.
  if (!isInstalled || !DONATE_ADDRESS) return null;

  async function handleDonate() {
    if (status === "sending") return;
    setStatus("sending");
    try {
      await MiniKit.pay({
        reference: crypto.randomUUID(),
        to: DONATE_ADDRESS as `0x${string}`,
        tokens: [{ symbol: Tokens.WLD, token_amount: "1" }],
        description: "Water — thank you",
      });
      setStatus("sent");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("idle");
    }
  }

  return (
    <button
      type="button"
      aria-label="1 WLDを寄付する"
      onClick={handleDonate}
      disabled={status === "sending"}
      className={`donate-button${status === "sent" ? " donate-button--sent" : ""}`}
    >
      <HeartIcon className="donate-button__icon" />
    </button>
  );
}
