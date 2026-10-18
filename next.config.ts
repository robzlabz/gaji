import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sembunyikan badge dev Next.js supaya screenshot/demo bersih.
  devIndicators: false,
  // Output ramping untuk image Docker (dipakai di Dockerfile).
  output: "standalone",
};

export default nextConfig;
