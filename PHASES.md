# Phase plan — Strong Tower Mods

Current as of `d185a43`. Roadmap from CLAUDE.md re-stated in execution order
with concrete status, what's blocked, and what unblocks it.

---

## Status at a glance

| #    | Phase                                             | Status        | Notes |
|------|---------------------------------------------------|---------------|-------|
| 0    | Baseline (install, typecheck, test)                | shipped       | `5da8b15` |
| A    | ElevenLabs voice pipeline (mock-first)             | shipped       | `5da8b15` — real TTS gated on `ELEVENLABS_API_KEY` |
| B    | FaceFXWrapper + xWMAEncode + FUZ packaging          | blocked       | needs FaceFXWrapper.exe, xWMAEncode.exe — see `tools/README.md` |
| C    | F4SE C++ communication plugin + game-state hooks    | blocked       | needs F4SE SDK, Visual Studio 2019/2022, Fallout 4 install |
| D    | MemPalace persistent memory                         | shipped       | `dc03bad` |
| E1   | `shared/db` — Prisma + repositories + SQLite        | shipped       | `5da8b15` |
| E2   | `shared/auth` — JWT (jose) + Nexus SSO (mock)       | shipped       | `5da8b15` — real Nexus SSO gated on registration approval |
| E3   | `shared/billing` — Stripe customer/sub + pre-auth   | shipped       | `5da8b15` — real Stripe gated on `STRIPE_SECRET_KEY` + price ids |
| E4   | Cloud companion API auth + per-turn metering        | shipped       | `5da8b15` |
| E5   | Cloud `/load-order/rank` + `/conflict/explain`      | shipped       | `23faf05` |
| E6   | Cloud-endpoint integration tests + `buildApp`       | shipped       | `19997f2` |
| F1   | PyInstaller frozen `sidecar.exe`                    | shipped       | `939cff7` |
| F2   | MCM (Mod Configuration Menu)                        | blocked       | needs Creation Kit + MCM SDK (Neanka) |
| G    | Free Nexus release (text-only marketing anchor)     | blocked       | depends on B + C + F2 producing a playable artifact |
| 2    | Vortex extension scaffold                           | shipped       | `3fa3424` |
| 2.8  | ESP binary parser + record-level conflict detection | shipped       | `df52e0e` |
| CI   | GitHub Actions workflow                             | shipped       | `18e87c9` |

Test totals across all six packages: **126 passing + 1 skipped, 0 failing**.

| Package                 | Tests          |
|-------------------------|----------------|
| `shared/db`             | 6              |
| `shared/auth`           | 9              |
| `shared/billing`        | 11             |
| `shared/api/companion`  | 13             |
| `audio-pipeline`        | 18 + 1 skip    |
| `extension`             | 69             |

---

## Blocked work — what unblocks each phase

### Phase B — Voice lip-sync + Bethesda audio packaging

What's needed (drop into `tools/`, set env var):

* `tools/FaceFXWrapper.exe` → `FACEFX_WRAPPER_PATH`
* `tools/xWMAEncode.exe`    → `XWMAENCODE_PATH`

What ships when B lands:

* Sidecar response's `lipPath` becomes a real `.lip` file
* `audioPath` becomes a `.fuz` (XWM + LIP container) the F4SE plugin can hand to the game

### Phase C — F4SE communication plugin

What's needed:

* Fallout 4 installed locally (Steam)
* F4SE SDK cloned to a sibling dir (e.g. `D:\f4se\` from `https://github.com/ianpatt/f4se`)
* Visual Studio 2022 with the "Desktop development with C++" workload
* Optional: CommonLibF4 (Ryan-rsm-McKenzie's modern wrapper)

What ships when C lands:

* In-game companion can actually receive and play turns
* Game-state hooks (location / quest stage / weather / time / combat / affinity) feed the cloud prompt
* Phase 1 reaches the first playable milestone

### Phase F2 — MCM (Mod Configuration Menu)

What's needed:

* Creation Kit (free, Steam)
* MCM SDK installed via Vortex (Neanka — https://www.nexusmods.com/fallout4/mods/21497)

What ships when F2 lands:

* In-game settings panel for the companion (voice toggles, memory backup, log out)
* Required for a polished Nexus release

### Phase G — Free Nexus release

Depends on B + C + F2 producing a playable artifact. Also requires:

* Nexus Mods account for posting the mod
* Screenshots + a 30–60 s gameplay GIF for the mod page

### Live API integration (any-time once keys are in `.env`)

| Key                                           | Source                                | Unlocks                                |
|-----------------------------------------------|---------------------------------------|----------------------------------------|
| `ANTHROPIC_API_KEY`                           | console.anthropic.com                 | Real Claude in cloud `/turn`, `/load-order/rank`, `/conflict/explain` |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`  | elevenlabs.io                         | Real Sarah Chen voice (replaces silent WAV mock) |
| `NEXUS_API_KEY`                               | nexusmods.com → My Account → API      | Real Nexus metadata in extension       |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com                  | Real billing (six `STRIPE_PRICE_*` env vars also required, one per tier) |

### External approvals (start the request now — slow path)

* **Nexus SSO registration** — email support@nexusmods.com requesting `strong-tower-mods` be approved. Required before real-mode (non-mock) Nexus SSO works for any user.

---

## Recommended sequence when binaries arrive

Order of operations that minimises blocking dependencies:

1. **F4SE SDK + Visual Studio + Fallout 4** → start Phase C (the longest pole).
2. **In parallel: FaceFXWrapper + xWMAEncode in `tools/`** → start Phase B. Lands while you're still on C.
3. When Phase B output (`.fuz`) is consumable, wire it into the Phase C plugin's audio dispatch.
4. **Creation Kit** → start Phase F2 once the companion is responding in-game. MCM needs the companion to exist first.
5. **Phase G — Nexus release.** Free variant ships once B/C/F2 produce a stable artifact.

---

## What can still ship without your binaries

If you come back without the binaries and want forward motion, options in
descending value:

* **End-user README + Nexus mod page draft.** Documents the install steps,
  pricing tiers, system requirements, and the FAQ a Nexus user will have.
  Useful well before the free release goes live.
* **FormID-level conflict detection.** Walks ESP record bodies, decodes
  local formIDs through the master table, surfaces real record-level
  conflicts (not just type overlaps). Substantial scope — needs a corpus
  of real plugins to validate against.
* **Stripe price provisioning automation.** A `scripts/provision-stripe.ts`
  that creates the seven `STRIPE_PRICE_*` records once `STRIPE_SECRET_KEY`
  lands so you don't have to click through the dashboard.
* **Vortex extension UI panels.** Settings, account-link dialog,
  per-conflict explanation modal — all React components inside Vortex.
  Currently the extension exposes its features as actions in the toolbar;
  proper panels would land in `src/vortex-ui/` and would need vortex-api
  installed locally.

---

## Pointers

* **CLAUDE.md** — the original master design doc; unchanged. Includes the
  full architecture, monetisation tiers, and knowledge-base structure.
* **tools/README.md** — where to put each non-redistributable binary and
  which env var it maps to.
* **packages/extension/INSTALL.md** — five-step Vortex install guide
  with a symlink-for-dev option.
* **.env.example** — every env var the codebase reads, grouped by
  subsystem. Copy to `.env` and fill in the ones you have.
* **.github/workflows/ci.yml** — JS (Bun) + Python (uv) jobs that run on
  every push to `main` and every PR.
