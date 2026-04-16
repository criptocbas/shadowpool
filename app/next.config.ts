import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler (stable in Next.js 16 / React 19.2). Auto-memoizes
  // components and hooks so manual useMemo/useCallback calls become
  // largely optional. The compiler bails on code it can't analyze
  // safely; bails are warnings, not errors.
  reactCompiler: true,

  // Pin the workspace root so Turbopack doesn't warn about the
  // root-level yarn.lock from the outer Anchor workspace.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
