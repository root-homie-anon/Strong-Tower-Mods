# Installing the Strong Tower Mods Vortex extension (Windows)

This package contains five pure-logic modules (`nexus-api/`,
`load-order/`, `conflict/`, `deploy/`, `account/` + `orchestration.ts`)
that compile and test without Vortex installed, plus a wiring file
(`src/vortex-init.ts`) that loads inside Vortex itself. The wiring
file is committed but excluded from the default TypeScript build
because its `vortex-api` import only resolves once you've actually
installed Vortex locally.

Every shell command below is **PowerShell**. `cmd.exe` equivalents are
called out where the syntax differs.

## One-time setup

```powershell
# 1. Install Vortex itself (free)
#    https://www.nexusmods.com/site/mods/1

# 2. Pull in the vortex-api types from GitHub
Set-Location D:\Strong-Tower-Mods\packages\extension
bun add --dev github:Nexus-Mods/vortex-api

# 3. Re-include vortex-init.ts in the build
#    Open tsconfig.json in this dir and REMOVE the "src/vortex-init.ts"
#    line from the "exclude" array.

# 4. Remove the @ts-nocheck directive from the top of src/vortex-init.ts
#    (line 30). Run `bun run typecheck` afterwards — every Vortex API
#    surface used is real, the directive existed only because vortex-api
#    wasn't installed before step 2.

# 5. Build the extension
bun run build
```

After the build, `dist/` contains the JS files Vortex will load.

## Pack and install into Vortex

Vortex loads extensions from `%APPDATA%\Vortex\plugins\<extension-id>\`.
The directory must contain (at minimum):

- `info.json` — extension manifest (already committed at the package root)
- `index.js` — built entry point (`dist/vortex-init.js` after the build above)
- The rest of `dist/` — the modules `vortex-init.js` imports

### Option A — symlink for fast dev iteration (recommended)

Open PowerShell **as Administrator** (symlinks require it on Windows by
default unless Developer Mode is enabled):

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:APPDATA\Vortex\plugins\strong-tower-mods-vortex" `
  -Target "D:\Strong-Tower-Mods\packages\extension"
```

If you prefer `cmd.exe`:

```cmd
mklink /D "%APPDATA%\Vortex\plugins\strong-tower-mods-vortex" "D:\Strong-Tower-Mods\packages\extension"
```

Then in Vortex: **Extensions** tab → **Reload** (or restart Vortex).
Edit → `bun run build` → click Reload, no repack needed.

### Option B — pack and install file (for distribution)

From `packages/extension/`:

```powershell
bun run build

# Pack info.json + dist/ + package.json into a zip.
# Compress-Archive ships with PowerShell — no 7-Zip needed.
Compress-Archive `
  -Path info.json, dist, package.json `
  -DestinationPath strong-tower-mods-vortex-0.1.0.zip `
  -Force
```

If you have 7-Zip installed and prefer it:

```powershell
& "C:\Program Files\7-Zip\7z.exe" a -tzip strong-tower-mods-vortex-0.1.0.zip info.json dist/ package.json
```

In Vortex: **Extensions** tab → **Drop file** (top-right) → drag the
`.zip` in.

## What the extension expects from the cloud

The four user-visible actions (Sort Load Order, Detect Conflicts,
Parse Latest Crash, Link Account) eventually call the companion API
at the URL configured in extension settings.

For local dev, run the cloud in a separate PowerShell window:

```powershell
Set-Location D:\Strong-Tower-Mods\packages\shared\api\companion

# Set the mock flags for THIS shell session only (cleared when the
# window closes). These three together make the cloud accept any
# bearer, mock Anthropic calls, and mock Stripe calls so you don't
# need any API keys.
$env:ANTHROPIC_MOCK = "true"
$env:AUTH_MOCK      = "true"
$env:STRIPE_MOCK    = "true"
$env:JWT_SECRET     = "dev-jwt-secret-at-least-thirty-two-characters-long"

bun run dev
# Cloud listens on http://127.0.0.1:8080
```

If you're in `cmd.exe`:

```cmd
set ANTHROPIC_MOCK=true
set AUTH_MOCK=true
set STRIPE_MOCK=true
set JWT_SECRET=dev-jwt-secret-at-least-thirty-two-characters-long
bun run dev
```

Then in Vortex's Strong Tower Mods settings, point the **Cloud Base
URL** at `http://127.0.0.1:8080` and click **Link Account** to mint a
JWT through the mock SSO flow.

## Troubleshooting

- **`Cannot find module 'vortex-api'`** — you skipped step 2. Run `bun add --dev github:Nexus-Mods/vortex-api` from `packages/extension/`.
- **Symlink in step 5 fails with "You do not have sufficient privilege"** — you need an Admin PowerShell, or enable Developer Mode in Settings → Privacy & security → For developers.
- **Vortex doesn't pick up the extension after a symlink** — Vortex caches the plugin list; click **Reload Extensions** from the Extensions tab or restart Vortex.
- **`Cloud /load-order/rank returned 401`** — the JWT in extension state has expired or the cloud rebooted. Click **Unlink** then **Link Account** to mint a fresh one.
- **AI ranking returns the deterministic fallback heuristic, not Claude** — the cloud is running with `ANTHROPIC_MOCK=true`. Clear `$env:ANTHROPIC_MOCK` and set `$env:ANTHROPIC_API_KEY` to your real Anthropic key.
- **Cloud refuses to start with `FATAL: ANTHROPIC_API_KEY is not set and ANTHROPIC_MOCK is not "true"`** — the four `$env:` lines above are mandatory in dev mode; set them in the same PowerShell window before `bun run dev`. They don't persist across windows.
- **PowerShell complains about `&` or `$env:`** — you're probably in `cmd.exe`. Either start `pwsh.exe` / `powershell.exe`, or use the `cmd` block above.
