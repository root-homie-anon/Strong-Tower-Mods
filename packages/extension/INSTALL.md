# Installing the Strong Tower Mods Vortex extension

This package contains five pure-logic modules (`nexus-api/`, `load-order/`, `conflict/`, `deploy/`, `account/` + `orchestration.ts`) that compile and test without Vortex installed, plus a wiring file (`src/vortex-init.ts`) that loads inside Vortex itself. The wiring file is committed but excluded from the default TypeScript build because its `vortex-api` import only resolves once you've actually installed Vortex locally.

## One-time setup

```bash
# 1. Install Vortex itself (free)
#    https://www.nexusmods.com/site/mods/1

# 2. From this directory, pull in the vortex-api types
cd packages/extension
bun add --dev github:Nexus-Mods/vortex-api

# 3. Re-include vortex-init.ts in the build
#    Open tsconfig.json and remove the "src/vortex-init.ts" line from
#    the "exclude" array.

# 4. Remove the @ts-nocheck directive from the top of src/vortex-init.ts
#    once you've verified the file typechecks (it should — every
#    Vortex API surface used is real, the directive existed only
#    because vortex-api wasn't installed).

# 5. Build the extension
bun run build
```

After the build, `dist/` contains the JS files Vortex will load.

## Pack and install into Vortex

Vortex extensions are loaded from `%APPDATA%\Vortex\plugins\<extension-id>\`. The directory must contain (at minimum):

- `info.json` — extension manifest (already committed at the package root)
- `index.js` — built entry point (`dist/vortex-init.js` after the build above)
- The rest of `dist/` — the modules `vortex-init.js` imports

### Option A — symlink for fast dev iteration

```cmd
mklink /D "%APPDATA%\Vortex\plugins\strong-tower-mods-vortex" "D:\Strong-Tower-Mods\packages\extension"
```

Then in Vortex: **Extensions → Reload** (or restart Vortex). Edit → rebuild → reload, no repack.

### Option B — pack and install file (for distribution)

```bash
# From packages/extension/
bun run build
# Pack info.json + dist/ + package.json into a zip
7z a -tzip strong-tower-mods-vortex-0.1.0.zip info.json dist/ package.json
```

In Vortex: **Extensions tab → Drop file** (top-right) → drag the `.zip` in.

## What the extension expects from the cloud

The four user-visible actions (Sort Load Order, Detect Conflicts, Parse Latest Crash, Link Account) all eventually call the companion API at the URL configured in extension settings. For local dev, run the cloud:

```bash
# From the repo root
cd packages/shared/api/companion
ANTHROPIC_MOCK=true AUTH_MOCK=true STRIPE_MOCK=true bun run dev
# Cloud listens on http://127.0.0.1:8080
```

Then in Vortex's Strong Tower Mods settings, point the **Cloud Base URL** at `http://127.0.0.1:8080` and **Link Account** to mint a JWT through the mock SSO flow.

## Troubleshooting

- **`Cannot find module 'vortex-api'`**: you skipped step 2 above. Run `bun add --dev github:Nexus-Mods/vortex-api` from this directory.
- **Vortex doesn't pick up the extension after a symlink**: Vortex caches the plugin list; click **Reload Extensions** from the Extensions tab or restart Vortex.
- **`Cloud /load-order/rank returned 401`**: the JWT in extension state has expired or the cloud rebooted. Click **Unlink** then **Link Account** to mint a fresh one.
- **AI ranking is the deterministic fallback heuristic, not Claude**: the cloud is running with `ANTHROPIC_MOCK=true`. Drop that env var and set `ANTHROPIC_API_KEY` to use the real Claude path.
