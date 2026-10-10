"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";

/*
 * Voxy-style passenger van — side profile, drawn as inline SVG.
 *
 * The fleet's signature vehicle (Toyota Voxy-class one-box MPV): tall cabin,
 * very short bonnet, steeply raked windscreen, near-vertical tailgate, big
 * glasshouse with blacked A/B/C pillars and wheels tucked inside the arches.
 * Drawn from scratch in the charcoal / warm-orange brand palette (a web search
 * for free "voxy van svg" assets only turns up paid stock, so there is no
 * royalty-free third-party file to embed). Wheel arches are true path cut-outs,
 * so the illustration sits cleanly on any panel colour.
 *
 * Client component only because `useId` gives each instance unique gradient
 * ids: the responsive heroes render a hidden and a visible copy in the same
 * document, and duplicate `url(#…)` ids would make the visible copy lose its
 * fills.
 */

// Body silhouette, facing right. Ground ≈ y190, roof ≈ y48; arches are cut on a
// 32px radius around each wheel centre so the 26px tyres tuck inside them.
const BODY_PATH = [
  "M80 172",
  "L80 84", // near-vertical tailgate
  "C82 66 90 54 104 50", // rear roof corner
  "L300 46", // roof
  "C318 46 332 52 342 62", // roof front corner
  "L364 104", // raked windscreen
  "C370 112 378 117 390 118", // cowl
  "L422 120", // short bonnet
  "C432 121 438 130 438 142", // nose
  "L434 172", // front bumper to sill
  "L402 172",
  "A32 32 0 0 0 338 172", // front arch cut-out
  "L184 172", // rocker between arches
  "A32 32 0 0 0 120 172", // rear arch cut-out
  "L80 172",
  "Z",
].join(" ");

const GLASS_PATH = [
  "M122 64",
  "L296 60",
  "C316 60 330 66 340 76", // windscreen top corner
  "L360 106", // windscreen base
  "C356 111 350 114 342 114", // cowl into beltline
  "L154 114", // beltline
  "C144 98 132 80 122 64", // C-pillar up to roof
  "Z",
].join(" ");

export function VoxyVan({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const bodyId = `${uid}-body`;
  const glassId = `${uid}-glass`;
  const underlineId = `${uid}-underline`;

  return (
    <svg
      viewBox="0 0 520 220"
      role="img"
      aria-label="Passenger van (Voxy) illustration"
      className={cn("h-auto w-full", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={bodyId} x1="0" y1="46" x2="0" y2="172" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6a7078" />
          <stop offset="0.5" stopColor="#454a52" />
          <stop offset="1" stopColor="#2c3138" />
        </linearGradient>
        <linearGradient id={glassId} x1="150" y1="58" x2="360" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6f7b8a" />
          <stop offset="1" stopColor="#98a4b3" />
        </linearGradient>
        <linearGradient id={underlineId} x1="130" y1="0" x2="390" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f15a24" stopOpacity="0" />
          <stop offset="0.5" stopColor="#f15a24" stopOpacity="0.85" />
          <stop offset="1" stopColor="#f15a24" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="262" cy="198" rx="166" ry="7" fill="#000000" opacity="0.45" />

      {/* wheels — drawn first so the arch cut-outs tuck them in */}
      <g>
        {[152, 370].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={170} r="26" fill="#0d1014" stroke="#4b5158" strokeWidth="2" />
            <circle cx={cx} cy={170} r="12" fill="#20252b" stroke="#5a6169" strokeWidth="1.5" />
            <circle cx={cx} cy={170} r="3.5" fill="#5a6169" />
          </g>
        ))}
      </g>

      {/* body with wheel-arch cut-outs */}
      <path d={BODY_PATH} fill={`url(#${bodyId})`} stroke="#565c64" strokeWidth="2" strokeLinejoin="round" />

      {/* glasshouse */}
      <path d={GLASS_PATH} fill={`url(#${glassId})`} />

      {/* blacked pillars — much darker than the glass */}
      <g stroke="#0a0d11" strokeWidth="7" strokeLinecap="round">
        <path d="M330 62 L352 105" />
        <path d="M250 61 L246 111" />
        <path d="M196 62 L192 111" />
      </g>

      {/* roof rail, kept inside the roof line */}
      <path d="M118 57 L298 53" stroke="#6a7078" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />

      {/* door seams + sliding rail */}
      <g stroke="#0b0e12" strokeWidth="2" opacity="0.45">
        <path d="M356 116 L360 168" />
        <path d="M252 116 L256 172" />
        <path d="M200 116 L204 172" />
        <path d="M204 126 L252 126" />
      </g>

      {/* door handles */}
      <g stroke="#c7ccd3" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
        <path d="M232 124 L242 124" />
        <path d="M304 123 L314 123" />
      </g>

      {/* lights, fully inside the body outline */}
      <path d="M404 122 L420 123 C424 127 424 133 420 137 L404 136 Z" fill="#f15a24" />
      <path d="M85 100 L91 99 L91 144 L85 145 Z" fill="#f15a24" />

      {/* brand underline, centred under the van */}
      <path d="M130 206 L390 206" stroke={`url(#${underlineId})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}