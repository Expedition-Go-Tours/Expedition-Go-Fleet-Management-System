import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires inline scripts for hydration; eval needed for dev tools
      // TODO: migrate to nonce-based script authorization for production
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // MapLibre GL injects inline styles for map rendering
      "style-src 'self' 'unsafe-inline'",
      // MapLibre tiles, OpenFreeMap tiles, and Photon geocoding
      "img-src 'self' data: blob: https://tiles.openfreemap.org https://*.tile.openstreetmap.org https://photon.komoot.io",
      // Geoapify routing API, Photon geocoding, Firebase
      "connect-src 'self' https://api.geoapify.com https://photon.komoot.io https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com",
      // MapLibre GL uses blob workers
      "worker-src 'self' blob:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["jose", "jwks-rsa"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
