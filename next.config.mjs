/** @type {import('next').NextConfig} */

// In production the Next.js app and the engine (SSE) run as two processes.
// These rewrites proxy the data endpoints to the engine so the browser only
// ever talks to one origin — no CORS, no client-side URL config needed.
// ENGINE_ORIGIN defaults to the local engine on :8080.
const ENGINE_ORIGIN = process.env.ENGINE_ORIGIN ?? "http://127.0.0.1:8080";

const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return [
      { source: "/stream", destination: `${ENGINE_ORIGIN}/stream` },
      { source: "/state", destination: `${ENGINE_ORIGIN}/state` },
      { source: "/control", destination: `${ENGINE_ORIGIN}/control` },
    ];
  },
};

export default nextConfig;
