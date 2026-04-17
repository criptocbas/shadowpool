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
  //
  // `resolveAlias` stubs `fs` to an empty module. The @arcium-hq/client
  // ESM entry has `import fs from 'fs'` at the top (used only by the
  // Node-only `uploadCircuit` helper we never call from the browser).
  // Without this alias, Turbopack's client-bundle graph fails on the
  // `fs` import. The stub lets the package load; any accidental
  // `fs.readFileSync` call would throw at runtime rather than breaking
  // the build. See src/lib/_empty-module.ts.
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      // Stub `fs` only — used by Anchor's nodewallet/workspace and by
      // @arcium-hq/client's `uploadCircuit` helper, neither of which is
      // reachable at browser runtime. Stubbing the other Node built-ins
      // (path/os) breaks legitimate SSR-side use. The stub is an empty
      // object; a runtime call to `fs.readFileSync` would throw, which
      // is the right failure mode if we ever accidentally ship a code
      // path that depends on it.
      fs: "./src/lib/_empty-module.ts",
      "node:fs": "./src/lib/_empty-module.ts",
      "fs/promises": "./src/lib/_empty-module.ts",
      "node:fs/promises": "./src/lib/_empty-module.ts",
    },
  },
};

export default nextConfig;
