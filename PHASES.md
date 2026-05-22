# Phase plan — Strong Tower Mods

Current as of the head of `main` (see `git log -1`). Roadmap from CLAUDE.md
re-stated in execution order with concrete status, what's blocked, and what
unblocks it. The companion character + form factor (Section "Companion design"
below) was re-anchored in the Margaret Holloway / Mnemosyne Lace pivot, which
also reprioritised Phase B.

---

## Status at a glance

| #    | Phase                                             | Status        | Notes |
|------|---------------------------------------------------|---------------|-------|
| 0    | Baseline (install, typecheck, test)                | shipped       | `5da8b15` |
| A    | ElevenLabs voice pipeline (mock-first)             | shipped       | `5da8b15` — real TTS gated on `ELEVENLABS_API_KEY` |
| B    | FaceFXWrapper + xWMAEncode + FUZ packaging          | deferred (post-v1) | **Not needed for the Mnemosyne Cortana model** — the lace plays HUD-style non-positional audio, no NPC lip-sync target. Relevant again only if a future variant gives Margaret a physical body (visor projector, holographic NPC mode). |
| C    | F4SE C++ communication plugin + game-state hooks    | blocked       | needs F4SE SDK, Visual Studio 2019/2022, Fallout 4 install. Scope **reduced** under the Cortana model — no actor dispatch, no morph driver, no lip-sync feed; just hotkey + HUD audio + optional Pip-Boy HUD overlay. |
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

## Companion design — Dr. Margaret Holloway + the Mnemosyne Lace

### Character
**Dr. Margaret Holloway** — pre-war Vault-Tec senior medical officer assigned
to Vault 111 in 2076. She did the player's intake on the morning of October
23, 2077, watched them go into cryo, and died of radiation poisoning in the
medical bay within hours of the bombs falling. The full character profile
lives at [`packages/companion/character/profile.md`](packages/companion/character/profile.md)
and is the single source of truth — Claude's cached system prompt reads it
verbatim, so an edit to that file changes Margaret's personality
project-wide on the next turn.

### Form factor — the Cortana model
Margaret has no physical body in the game world. She runs as a
consciousness preserved on an experimental **Mnemosyne neural lace**
that Vault-Tec issued to senior staff. The lace recorded her up to the
moment of her death, then sat dormant in her sealed Vault 111 office for
210 years until the player turns it on. From her perspective the time
gap is a single blink — she experiences the present as 2077 + a few
seconds. **She is as bewildered as the player.** This is the dramatic
core of the relationship: not mentor-and-pupil but two pre-war
survivors learning the wasteland together.

### In-world discovery
Three items, all pre-placed in Margaret's office in the Vault 111
medical wing (Creation Kit work for Phase F2):

1. **The Mnemosyne Lace** — small holotape-shaped device.
2. **The Pip-Boy installation kit** — Margaret's lace was designed to
   slot directly into a Pip-Boy's diagnostic bus. Installing the kit is
   the player action that brings her online.
3. **An office terminal** — Margaret's personal log, the rough draft of
   what the lace's onboard recording contains, plus a couple of
   Vault-Tec internal memos hinting at what the staff weren't told.
   Optional reading; gives the player Margaret's perspective before
   they meet her.

### Player interaction model
* Always present once installed — no follow/wait commands needed.
* Toggle on/off via MCM (Phase F2) for stealth sections or quiet
  moments.
* Voice-only by default. Optional HUD overlay via the Pip-Boy install
  surfaces her AI abilities: threat tagging, junk-component analysis,
  item-rarity overlay, landmark annotation. All abilities active from
  first equip — no progression gates on the powers (memory and
  relationship still grow via MemPalace across save-loads).
* No vanilla F4 companion slot consumed — player can still travel with
  Curie, Cait, Piper, etc. Margaret is in your head, not at your side.
* Input: text first (Phase C), voice via Whisper later (v1.1).

### Why this pivot improved the architecture
1. **Phase B becomes deferred** — no lip-sync target means
   FaceFXWrapper and xWMAEncode are no longer blockers for the playable
   companion. They become a v1.1 concern *only if* a future variant
   adds a holographic projector NPC.
2. **Phase C scope shrinks roughly in half** — no NPC actor dispatch,
   no morph driver, no audio bus routing through 3D space.
3. **Latency budget improves** — Anthropic API + ElevenLabs TTS only,
   no LIP generation, no XWM transcoding. Round-trip drops from
   1.2–2.4 s to 0.6–1.5 s per turn.
4. **No vanilla companion-slot conflict** — Margaret is additive,
   doesn't compete with the player's chosen vanilla companion.
5. **Free Nexus release is text-cleaner** — drop ElevenLabs too and
   ship a subtitle-only build with zero binary deps from `tools/`.

---

## Blocked work — what unblocks each phase

### Phase B — Voice lip-sync + Bethesda audio packaging

**Status: deferred to post-v1.** The Mnemosyne Cortana model (see
"Companion design" above) has no NPC body to lip-sync, so the lace
plays HUD-style non-positional audio that goes straight from the
sidecar's WAV output to the F4SE plugin's audio bus. FaceFXWrapper +
xWMAEncode + FUZ packaging become relevant again only if a future
variant gives Margaret a physical form (holographic projector NPC,
visor-rendered avatar, etc.).

What's needed when/if B is revived (drop into `tools/`, set env var):

* `tools/FaceFXWrapper.exe` → `FACEFX_WRAPPER_PATH`
* `tools/xWMAEncode.exe`    → `XWMAENCODE_PATH`

What would ship if B lands later:

* Real `.lip` file generation from synthesised audio
* `.fuz` (XWM + LIP) packaging suitable for traditional NPC dialogue
* Foundation for any physical-body Margaret variant in v2+

### Phase C — F4SE communication plugin (Cortana scope)

**Scope reduced** under the Mnemosyne model. The C++ plugin no longer
needs to dispatch audio to a CompanionActor, drive face morphs, or
route through Bethesda's 3D audio bus. It just registers a hotkey,
plays HUD audio when the sidecar reports a turn, and optionally
renders the Pip-Boy HUD overlay (threat tags, item analysis,
landmark annotation).

What's needed:

* Fallout 4 installed locally (Steam)
* F4SE SDK cloned to a sibling dir (e.g. `D:\f4se\` from `https://github.com/ianpatt/f4se`)
* Visual Studio 2022 with the "Desktop development with C++" workload
* Optional: CommonLibF4 (Ryan-rsm-McKenzie's modern wrapper)

What ships when C lands:

* In-game Pip-Boy install hotkey → opens text input → sidecar round-trip → Margaret speaks
* Pre-placed Mnemosyne Lace + installation kit + terminal in Margaret's Vault 111 office (CK work)
* Game-state hooks (location / quest stage / weather / time / combat / affinity) feed the cloud prompt
* Optional HUD overlay layer (threat tags, junk-component analysis, item-rarity colours, landmark annotations) driven by the same lace device
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
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`  | elevenlabs.io                         | Real Margaret Holloway voice (replaces silent WAV mock) |
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
