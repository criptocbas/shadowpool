// Empty stub — aliased to `fs` in next.config.ts for client bundles.
// The @arcium-hq/client package has `import fs from 'fs'` at the top of
// its ESM entry (build/index.mjs:10) used only inside `uploadCircuit`,
// a helper we never call from the browser. Stubbing `fs` to this empty
// module lets the package load cleanly client-side; any accidental
// `fs.readFileSync` call would throw at runtime (not at build time),
// which is the right failure mode.
const stub: Record<string, never> = {};
export default stub;
