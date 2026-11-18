# Copilot instructions

A collection of 3D models built from simple three.js geometries (TypeScript, Vite).

## Commands
- `npm run dev` – viewer (only way to verify texture baking/WebGL behaviour)
- `npm test` – `node --test test/*.test.ts`
- `npm run typecheck` – `tsc --noEmit`
- `npm run build`

Run typecheck and tests before finishing a change.

## Guidelines
- Keep seeds stable: don't add or remove `this.random()` draws in a model (use `this.skip(n)`), so a seed keeps producing identical shapes. Texture picks use WorldModel's separate PRNG.
- Without WebGL (Node/tests) materials are plain colours with no map/UVs.
- Thin cloth/sheet geometry must be wrapped with `withBackFaces()` (`src/models/terrain.ts`); MergeBuilder negative scale doesn't flip normals.
- Forest tier cross-fades must use the same distance metric in CPU (`src/forest/fade.js`) and all shaders.
- Toon shading patches three ShaderChunks via whitespace-tolerant regex; `setToonShading` must run before first compile.
- Build models from simple three.js geometries; register new models in `src/registry.ts`.
- Keep changes small and focused; add tests in `test/` for new behaviour; comment only non-obvious code.
