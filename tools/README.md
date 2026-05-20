# tools/

Per-contributor binaries that are **not** redistributable and therefore
not committed. Each file goes here once, the matching env var points
at its absolute path, and the rest of the repo picks it up.

The whole directory is gitignored except this README.

## What goes here

| File | Where to get it | Env var | Used by |
|---|---|---|---|
| `FaceFXWrapper.exe` | Nukem9's FaceFXWrapper release — included with the [LipFuzer](https://www.nexusmods.com/skyrimspecialedition/mods/20061) Nexus mod. Skyrim listing, works for Fallout 4. | `FACEFX_WRAPPER_PATH` | Phase B — lip-sync generation in the audio-pipeline sidecar |
| `xWMAEncode.exe` | DirectX SDK June 2010 → `bin\x64\xWMAEncode.exe`, or community redistributions on Nexus | `XWMAENCODE_PATH` | Phase B — WAV → XWM conversion before FUZ packing |
| `FO4Edit.exe` (xEdit) | [FO4Edit on Nexus](https://www.nexusmods.com/fallout4/mods/2737) | `XEDIT_PATH` | Phase 3 — mod-creator orchestration, ESP record-level analysis |

Setup checklist when you have a binary:

1. Drop the `.exe` into this directory.
2. Add the matching `<NAME>_PATH=D:\Strong-Tower-Mods\tools\<name>.exe` line to your `.env`. `.env.example` documents the canonical name for each.
3. Re-run `uv sync` / `bun install` if you also touched a manifest; nothing in this dir requires a rebuild of the JS/Python packages.

## What does NOT go here

* **F4SE SDK** — clone [ianpatt/f4se](https://github.com/ianpatt/f4se) to a sibling directory of this repo (e.g. `D:\f4se\`) and point `F4SE_SDK_PATH` at it. The SDK is too large to vendor; keeping it adjacent means upstream rebases are a single `git pull` away.
* **Creation Kit** — Steam install. No file to place; the Papyrus compiler lives at `<FO4>\Tools\Papyrus Compiler\PapyrusCompiler.exe`.
* **MCM SDK** (Neanka) — install via Vortex; the Papyrus headers land at `<FO4>\Data\Source\Scripts\MCM\` automatically.

## Why gitignored

Every binary in this list is freely available but **not** redistributable under the terms its author shipped it with. Committing them would violate those terms and conflate "the repo" with "stuff you legally need to fetch yourself once."
