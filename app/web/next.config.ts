import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@pharmacy/shared"],
  typedRoutes: false,
};

export default nextConfig;
