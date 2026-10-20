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
      // Firebase Auth requires apis.google.com for popup/redirect flow
      // TODO: migrate to nonce-based script authorization for production
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://*.googleapis.com",
      // MapLibre GL injects inline styles for map rendering
      "style-src 'self' 'unsafe-inline'",
      // MapLibre tiles, OpenFreeMap tiles, Photon geocoding, and Cloudinary
      // document previews
      "img-src 'self' data: blob: https://tiles.openfreemap.org https://*.tile.openstreetmap.org https://photon.komoot.io https://res.cloudinary.com",
      // Geoapify routing API, Photon geocoding, Firebase, Google Identity,
      // Cloudinary document delivery
      "connect-src 'self' https://api.geoapify.com https://photon.komoot.io https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://res.cloudinary.com https://api.cloudinary.com",
      // MapLibre GL uses blob workers
      "worker-src 'self' blob:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src 'self' https://apis.google.com https://accounts.google.com",
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
