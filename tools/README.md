# tools/ — binary install guide (Windows)

Per-contributor binaries that are **not** redistributable and therefore
not committed. Each file goes here once, an environment variable
points the rest of the repo at it, and you're done with that binary
until upstream ships an update.

Everything below assumes:

* Windows 10 or 11, x64.
* The repo is checked out at `D:\Strong-Tower-Mods\` — substitute your
  actual path everywhere you see that prefix below.
* PowerShell as your shell. `cmd.exe` equivalents are noted where the
  syntax differs.

The whole `tools/` directory is gitignored except for this README, so
nothing you drop in here will accidentally land in a commit.

---

## Quick reference

| Binary | Env var | Phase that needs it |
|---|---|---|
| `FaceFXWrapper.exe` | `FACEFX_WRAPPER_PATH` | B — lip-sync `.lip` file generation |
| `xWMAEncode.exe` | `XWMAENCODE_PATH` | B — WAV → XWM conversion (FUZ packing) |
| `FO4Edit.exe` | `XEDIT_PATH` | 3 — mod-creator ESP record analysis |
| F4SE SDK (cloned dir) | `F4SE_SDK_PATH` | C — companion C++ plugin build |
| Creation Kit (Steam) | — (path discovered automatically) | F2 — MCM authoring |
| MCM SDK (Neanka) | — (lives inside `<FO4>\Data\Source\Scripts\MCM\`) | F2 — Papyrus headers |

---

## 1. FaceFXWrapper.exe — Phase B

FaceFXWrapper is Nukem9's command-line wrapper around Bethesda's
FaceFX runtime. It produces `.lip` files from audio + transcript.
Originally shipped as a standalone Nexus mod for Skyrim; works
unchanged for Fallout 4.

### Download

1. Sign in at <https://www.nexusmods.com> (free account).
2. Visit <https://www.nexusmods.com/skyrimspecialedition/mods/20061>
   (LipFuzer — the easiest packaging that includes FaceFXWrapper).
3. **Files** tab → **Manual Download** the main file (≈ 5 MB `.7z`).

### Extract

1. Right-click the downloaded `.7z` → **7-Zip → Extract to "LipFuzer\"**.
   (Install 7-Zip from <https://www.7-zip.org> if you don't have it.)
2. Inside the extracted folder, navigate to `LipFuzer\Tools\` — you'll
   find `FaceFXWrapper.exe` plus a `FonixData.cdf` data file.
3. Copy **both** `FaceFXWrapper.exe` and `FonixData.cdf` into
   `D:\Strong-Tower-Mods\tools\`. The wrapper reads the .cdf at runtime
   from its own directory; without it the .exe runs but silently
   produces empty .lip files.

### Verify

In PowerShell:

```powershell
& "D:\Strong-Tower-Mods\tools\FaceFXWrapper.exe" --help
```

You should see a usage banner. If you get "data file missing" or the
prompt comes back instantly with no output, the `.cdf` is not next to
the `.exe`.

### Set the env var

See [Setting environment variables](#setting-environment-variables) below.
The value is the full absolute path including the filename:

```
FACEFX_WRAPPER_PATH=D:\Strong-Tower-Mods\tools\FaceFXWrapper.exe
```

---

## 2. xWMAEncode.exe — Phase B

xWMAEncode is Microsoft's command-line WAV → XWM encoder, shipped only
in the DirectX SDK June 2010 release. We use it to compress the
ElevenLabs TTS output into the format Bethesda's audio engine accepts
before FUZ packing.

### The S1023 install problem

The DirectX SDK June 2010 installer **fails with error S1023** on any
system that already has a newer Visual C++ 2010 Redistributable
installed (which is essentially every modern Windows install). This
is documented Microsoft behaviour — they never released a fixed
installer.

You have two options:

#### Option A — community redistribution (recommended; faster)

Several Nexus mods ship just the `xWMAEncode.exe` binary in a small
zip. The cleanest source is:

1. Visit <https://www.nexusmods.com/skyrimspecialedition/mods/20061>
   (LipFuzer again — it bundles xWMAEncode alongside FaceFXWrapper).
2. After extracting (you may already have it from step 1 above),
   `LipFuzer\Tools\xWMAEncode.exe` is there next to `FaceFXWrapper.exe`.
3. Copy `xWMAEncode.exe` into `D:\Strong-Tower-Mods\tools\`.

#### Option B — install the real DirectX SDK June 2010

Only do this if you specifically need the rest of the SDK for some
other reason.

1. Open `appwiz.cpl` (Control Panel → Programs & Features).
2. Uninstall both:
   * `Microsoft Visual C++ 2010 x86 Redistributable`
   * `Microsoft Visual C++ 2010 x64 Redistributable`
   (Save the version numbers — you'll reinstall them in step 5.)
3. Download the SDK installer from
   <https://www.microsoft.com/en-us/download/details.aspx?id=6812>
4. Run `DXSDK_Jun10.exe`. It should now install without S1023.
5. Reinstall the latest VC++ 2010 SP1 redistributables from
   <https://www.microsoft.com/en-us/download/details.aspx?id=26999>
   (x86 and x64; the page lists both).
6. Copy `<DXSDK>\Utilities\Bin\x64\xWMAEncode.exe` into
   `D:\Strong-Tower-Mods\tools\`.

### Verify

```powershell
& "D:\Strong-Tower-Mods\tools\xWMAEncode.exe"
```

Running with no args prints a usage banner. The xWMAEncode build is
ancient — it correctly warns about being deprecated; that's normal.

### Set the env var

```
XWMAENCODE_PATH=D:\Strong-Tower-Mods\tools\xWMAEncode.exe
```

---

## 3. FO4Edit.exe (xEdit) — Phase 3

xEdit is the de-facto ESP/ESM editor for every Bethesda game. We
shell out to it from the Phase 3 mod creator for record-level
analysis on plugins our extension can't decode statically.

### Download

1. Visit <https://www.nexusmods.com/fallout4/mods/2737>.
2. **Files** tab → **Manual Download** the main file (≈ 15 MB `.7z`).
3. Right-click → **7-Zip → Extract to "FO4Edit\"**.

### Place

xEdit is a multi-file install — it has scripts, INI files, and the
`.exe`. Don't drop just the .exe into `tools/`; put the whole
extracted folder somewhere and point the env var at the `.exe`:

```
D:\Tools\FO4Edit\
├── FO4Edit.exe          ← XEDIT_PATH points here
├── FO4Edit.ini
├── Edit Scripts\
└── ... (other support files)
```

Recommended location: `D:\Tools\FO4Edit\` (outside this repo). Don't
put it in the repo's `tools/` — xEdit writes back to its own dir
(logs, INI updates) and we don't want those churning our gitignore.

### Verify

Run `FO4Edit.exe` once interactively first — it asks you to confirm
the game path on first launch. After that it's fully scriptable.

### Set the env var

```
XEDIT_PATH=D:\Tools\FO4Edit\FO4Edit.exe
```

---

## 4. F4SE SDK — Phase C

This is the open-source SDK we link the C++ companion plugin against.
Do **not** put it in `tools/` — it's a multi-thousand-file source
tree that's expected to live as a sibling directory you `git pull`
periodically.

### Clone

```powershell
Set-Location D:\
git clone https://github.com/ianpatt/f4se.git
```

Confirms when complete:

```powershell
Test-Path D:\f4se\src\f4se\f4se.sln
```

If that returns `True`, you're set. The `f4se.sln` is what Visual
Studio 2022 will open for the Phase C build.

### Verify Visual Studio 2022 has the right workload

Open **Visual Studio Installer** → Modify your VS 2022 install →
ensure **"Desktop development with C++"** is checked, with the
following individual components:

* MSVC v143 (latest)
* Windows 11 SDK (or Windows 10 SDK, version 10.0.17763 or newer)
* C++ ATL for v143 build tools (x86 & x64)

### Set the env var

```
F4SE_SDK_PATH=D:\f4se
```

(Point at the directory, not at any file inside it — the Phase C
build script appends the right subpath.)

### Optional: CommonLibF4

The Ryan-rsm-McKenzie modern wrapper around F4SE makes the C++ much
nicer to write. Phase C will work without it but the code is more
verbose:

```powershell
Set-Location D:\
git clone https://github.com/Ryan-rsm-McKenzie/CommonLibF4.git
```

Don't set an env var for this one; the VS project file references
it via a relative path.

---

## 5. Creation Kit + MCM SDK — Phase F2

These don't go into `tools/` either — they live inside your Fallout 4
install directory.

### Creation Kit

1. In Steam, open the **Tools** library section (or set the filter to
   include Tools).
2. Search for **"Fallout 4 Creation Kit"** and install (free).
3. The Papyrus compiler lands at:
   ```
   <Steam>\steamapps\common\Fallout 4\Tools\Papyrus Compiler\PapyrusCompiler.exe
   ```
4. No env var needed — the Phase F2 build discovers it from the FO4
   game path.

### MCM SDK (Neanka)

1. With Vortex running, visit
   <https://www.nexusmods.com/fallout4/mods/21497>
2. Click **Vortex** on the file you want to install.
3. Vortex deploys the headers to:
   ```
   <FO4>\Data\Source\Scripts\MCM\
   ```
4. The Papyrus compiler picks them up automatically when MCM scripts
   `import` them.

---

## Setting environment variables

The cloud, the sidecar, and the extension all read these vars from
the **process environment** — not from any `.env` file. (Prisma
migrations do read `.env` at the repo root, but the runtime services
do not.) Pick the option that matches how long you want the variable
to live.

### Option A — PowerShell session (temporary)

Variable lives until the PowerShell window closes. Good for one-off
test runs.

```powershell
$env:FACEFX_WRAPPER_PATH = "D:\Strong-Tower-Mods\tools\FaceFXWrapper.exe"
$env:XWMAENCODE_PATH     = "D:\Strong-Tower-Mods\tools\xWMAEncode.exe"
$env:XEDIT_PATH          = "D:\Tools\FO4Edit\FO4Edit.exe"
$env:F4SE_SDK_PATH       = "D:\f4se"
```

To confirm:

```powershell
Get-ChildItem env: | Where-Object Name -Match '^(FACEFX|XWMA|XEDIT|F4SE)_'
```

### Option B — `setx` (persistent, user-wide)

Variable lives forever and applies to every **new** shell or process
your user account spawns. Existing shells are unaffected — close and
reopen PowerShell to pick up the change.

```powershell
setx FACEFX_WRAPPER_PATH "D:\Strong-Tower-Mods\tools\FaceFXWrapper.exe"
setx XWMAENCODE_PATH     "D:\Strong-Tower-Mods\tools\xWMAEncode.exe"
setx XEDIT_PATH          "D:\Tools\FO4Edit\FO4Edit.exe"
setx F4SE_SDK_PATH       "D:\f4se"
```

Open a fresh PowerShell window, then verify with the same
`Get-ChildItem env:` command above.

`setx` has a 1024-character limit per value and does **not** support
expansion of other env vars (`%VAR%` is taken literally). Stick to
absolute paths.

### Option C — Windows GUI

For visibility / undo-ability:

1. Press **Win** → type *environment variables* → **Edit the system
   environment variables**.
2. Click **Environment Variables…** in the dialog that opens.
3. Under **User variables**, click **New…** for each.
4. Click **OK** to close all three nested dialogs.
5. Open a fresh PowerShell — the new values are now in scope.

### Option D — `cmd.exe` (if you're using cmd, not PowerShell)

Session-only:

```cmd
set FACEFX_WRAPPER_PATH=D:\Strong-Tower-Mods\tools\FaceFXWrapper.exe
```

Persistent: use `setx` (same command works in cmd or PowerShell).

---

## After setting an env var

Restart any long-running process (the cloud, the sidecar) so it
inherits the new value. Tests pick up env at process start, so
`bun test` / `uv run pytest` from a fresh shell is enough.

---

## Why gitignored

Every binary in this list is freely available but **not**
redistributable under the terms its author shipped it with.
Committing them would violate those terms and conflate "the repo"
with "stuff you legally need to fetch yourself once."
