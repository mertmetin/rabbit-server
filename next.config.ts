import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (server.js plus only the files it needs) for the
  // Docker image.
  output: "standalone",
};

export default nextConfig;
