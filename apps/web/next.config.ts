import type { NextConfig } from "next";
import path from "node:path";

const r2Host = process.env.NEXT_PUBLIC_R2_IMAGE_HOST;
const remotePatterns = [{ protocol: "https" as const, hostname: "assets.tcgdex.net" }];

if (r2Host) {
  remotePatterns.push({
    protocol: "https",
    hostname: r2Host.replace(/^https?:\/\//, "").replace(/\/$/, "")
  });
}

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  images: {
    unoptimized: true,
    remotePatterns
  }
};

export default nextConfig;
