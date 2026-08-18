import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client is the only database driver in the server bundle. It ships a
  // native binding for local files, so keep it external rather than bundled.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
