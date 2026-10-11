import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import SmoothScroll from "@/components/layout/SmoothScroll";
import "./globals.css";

const dmSans = localFont({
  src: [
    {
      path: "../fonts/dmsans-variable-latin.woff2",
      weight: "100 1000",
      style: "normal",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

const manrope = localFont({
  src: [
    {
      path: "../fonts/manrope-variable-latin.woff2",
      weight: "200 800",
      style: "normal",
    },
  ],
  variable: "--font-manrope",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Fleet Management · Expedition Go Tours",
    template: "%s · Expedition Go Tours Fleet",
  },
  description: "Internal vehicle maintenance and fleet management for Expedition Go Tours.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${manrope.variable} h-full`}>
      <body className="bg-page text-ink flex min-h-full flex-col font-sans">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
