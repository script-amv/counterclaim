import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Shell } from "@/ui/shell";
import { isReplayOnly } from "@/cases/replay-only";
import "./globals.css";
const serif = localFont({
  src: "./fonts/fraunces.woff2",
  variable: "--face-serif",
  display: "swap",
  weight: "100 900",
});
const sans = localFont({
  src: "./fonts/dm-sans.woff2",
  variable: "--face-sans",
  display: "swap",
  weight: "100 1000",
});
export const metadata: Metadata = {
  title: "Counterclaim — The seller’s case desk",
  description:
    "Sourced evidence and considered responses for PayPal sandbox disputes. Demo seller data.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <Shell replayOnly={isReplayOnly()}>{children}</Shell>
      </body>
    </html>
  );
}
