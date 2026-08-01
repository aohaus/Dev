"use client";

import type { ReactNode } from "react";
import { MiniKitProvider } from "@worldcoin/minikit-js/minikit-provider";

const appId = process.env.NEXT_PUBLIC_WORLD_APP_ID;

export function Providers({ children }: { children: ReactNode }) {
  return <MiniKitProvider props={{ appId }}>{children}</MiniKitProvider>;
}
