# Strong Tower Mods — Master Project File

## System Overview
Strong Tower Mods is an AI-powered PC game modding suite targeting Fallout 4 via the Nexus Mods ecosystem. It solves three distinct problems: mod management complexity (Vortex is widely hated for conflict resolution), the high technical barrier to mod creation for casual players, and the absence of a truly intelligent in-game AI companion. The suite consists of three products — a free Vortex extension with AI-curated load order intelligence, a paid Electron desktop app (mod creator) with a credit-based agentic build pipeline, and a subscription AI companion that lives inside Fallout 4 with real-time voice, lip sync, and game state awareness. Everything is automated. The companion is the foundational build and marketing anchor. The creator monetizes the creative demand the companion surfaces.

---

## Session Start Hook
On every session start, fire the agent factory hook:
```
bash ~/.claude/hooks/session-start.sh "strong-tower-mods" "$(pwd)"
```
This loads existing agents, offers to create new ones if needed, and prepares the session.

---

## Orchestrator Behavior

This file is the root orchestrator. On session start:

1. Fire the session-start hook
2. Load state from `state/` if it exists
3. Ask the user: continue existing run, start a new one, or initialize a new sub-project
4. Spawn subagents scoped to their domain — they share no state unless explicitly passed
5. Multiple subagents can run in parallel

---

## Agent Team
All agents live in `.claude/agents/` and are shared across the project.

| Agent | Role |
|-------|------|
| `@orchestrator` | Drives the session, delegates tasks, manages state |
| `@companion-builder` | Builds and iterates the AI companion — F4SE pipeline, ElevenLabs integration, Claude API, lip sync, game state awareness |
| `@extension-builder` | Builds the Vortex extension — load order AI, conflict resolution, deploy pipeline, log capture, account linking |
| `@creator-builder` | Builds the mod creator desktop app — orchestration pipeline, ESP manipulation, Papyrus compilation, MCM generation, guided CK steps |
| `@knowledge-base` | Maintains the mod knowledge base — Nexus API sync, framework documentation, DLC records, engine constraint library, permissions data |
| `@billing` | Stripe integration — subscription management, metered billing, pre-authorization, session charging, spend ceiling enforcement |
| `@infra` | Cloud API, database, auth, deployment pipelines, environment management |
| `@qa` | Testing, validation, load order conflict simulation, mod build verification |

---

## Build Sequence

### Phase 1 — AI Companion (Foundation)
The companion is built first. It proves the full technical stack, serves as the marketing anchor on Nexus, and generates the first revenue. Everything else builds on what the companion proves.

- F4SE communication plugin (based on Mantella open source pipeline)
- FaceFXWrapper integration for real-time LIP file generation
- ElevenLabs voice pipeline with XWM/FUZ conversion
- Claude API integration with game state context injection
- Pre-war character personality and lore backfill
- Existing companion framework game state hooks (location, quest stage, weather, time, combat, affinity)
- Player memory system — persistent across sessions via MemPalace local palace architecture (wings, rooms, halls). Memory lives on user's machine alongside save files — no cloud sync, user's responsibility to back up. MCM includes one-click memory backup option.
- Facial expression morphs via F4SE driven by sentiment analysis
- MCM for companion behavior toggles
- Subscription billing via Stripe (Basic $9.99, Premium $24.99, Custom $19.99 base + $0.35/min metered)
- Real-time Stripe pre-authorization per session for Custom tier
- Free limited version for Nexus release (text only, basic memory) as marketing anchor

### Phase 2 — Vortex Extension
Built second. Becomes the deployment and log-capture arm of the creator. Also standalone value as AI load order manager.

- AI-curated load order — intelligent ordering based on mod relationships and compatibility
- Conflict detection and resolution with plain English explanations
- Auto-deploy pipeline for creator-built mods
- Game log capture and parsing for creator iteration loop
- Account linking to Strong Tower Mods platform
- Nexus API integration for mod metadata

### Phase 3 — Mod Creator Desktop App
Built third. Depends on Vortex extension being functional for the deploy/test loop.

- Natural language mod description intake
- Orchestration pipeline: engine constraint check → overlap detection → permissions check → complexity scoping → credit estimate → user approval → build → deploy → test → repair loop
- ESP manipulation engine (direct record creation without xEdit GUI)
- Papyrus script generation and CLI compilation
- MCM auto-generation for every mod
- Guided CK step generation for world placement mods
- Complexity calculator with itemized credit breakdown
- Credit pack billing and monthly subscription option
- Original brief stored as fix vs tuning contract
- Technical validation before delivery

---

## Project Structure

```
strong-tower-mods/
├── CLAUDE.md                        ← this file, root orchestrator
├── .claude/
│   └── agents/                      ← all agent definitions
├── .env                             ← secrets, never committed
├── .env.example                     ← committed, documents required vars
├── .github/
│   └── workflows/                   ← CI/CD pipelines
├── packages/
│   ├── companion/                   ← AI companion (Phase 1)
│   │   ├── f4se-plugin/             ← C++ F4SE communication plugin
│   │   ├── audio-pipeline/          ← ElevenLabs → XWM/FUZ → LIP pipeline
│   │   ├── game-state/              ← game state hooks and context builder
│   │   ├── character/               ← pre-war character personality and lore
│   │   └── memory/                  ← session and persistent memory system
│   ├── extension/                   ← Vortex extension (Phase 2)
│   │   ├── load-order/              ← AI load order intelligence
│   │   ├── conflict/                ← conflict detection and resolution
│   │   └── deploy/                  ← mod deployment and log capture pipeline
│   ├── creator/                     ← mod creator desktop app (Phase 3)
│   │   ├── orchestrator/            ← request pipeline and agent coordination
│   │   ├── esp-engine/              ← direct ESP record manipulation
│   │   ├── papyrus/                 ← script generation and CLI compilation
│   │   ├── mcm-generator/           ← automatic MCM generation
│   │   ├── ck-guide/                ← guided Creation Kit step generation
│   │   └── complexity/              ← complexity calculator and credit pricing
│   └── shared/                      ← shared across all packages
│       ├── api/                     ← cloud API (Express/Fastify)
│       ├── auth/                    ← Nexus SSO authentication, JWT session management
│       ├── billing/                 ← Stripe metered and subscription billing
│       └── db/                      ← database models and migrations
├── knowledge-base/
│   ├── tier1/                       ← auto-synced top 300 Nexus mods metadata
│   ├── tier2/                       ← deep framework APIs (SS2, Horizon, etc.)
│   ├── dlc/                         ← all 6 Fallout 4 DLC record structures
│   ├── engine-constraints/          ← known impossible request library
│   └── permissions/                 ← Nexus mod permissions cache
├── scripts/                         ← automation scripts
├── state/                           ← runtime state, gitignored
└── config.json                      ← project config schema
```

---

## config.json Schema

```json
{
  "project": {
    "name": "Strong Tower Mods",
    "slug": "strong-tower-mods",
    "version": "0.1.0"
  },
  "credentials": {
    "anthropic_key_path": ".env/ANTHROPIC_API_KEY",
    "elevenlabs_key_path": ".env/ELEVENLABS_API_KEY",
    "stripe_key_path": ".env/STRIPE_SECRET_KEY",
    "nexus_api_key_path": ".env/NEXUS_API_KEY",
    "db_url_path": ".env/DATABASE_URL"
  },
  "agents": {
    "companion_builder": { "model": "claude-sonnet-4-6", "max_tokens": 8192 },
    "creator_builder": { "model": "claude-sonnet-4-6", "max_tokens": 8192 },
    "knowledge_base": { "model": "claude-haiku-4-5-20251001", "max_tokens": 4096 }
  },
  "features": {
    "companion_voice": true,
    "companion_lip_sync": true,
    "creator_esp": true,
    "creator_papyrus": true,
    "creator_mcm": true,
    "creator_ck_guided": true,
    "knowledge_base_sync": true,
    "asset_ingestion": false,
    "voice_pipeline_creator": false
  }
}
```

---

## Monetization

### Companion Subscriptions
| Tier | Price | Description |
|------|-------|-------------|
| Basic | $9.99/mo | Passive ambient companion, text only, contextual one-liners |
| Premium | $24.99/mo | Full active engagement, ElevenLabs voice, pre-war character, session memory |
| Custom | $19.99/mo base + $0.35/min metered | User-defined companion, custom voice, custom knowledge base, no limits |

Custom tier uses Stripe real-time pre-authorization per session. User sets monthly spend ceiling at onboarding. Hard stop before session opens if no valid payment method.

### Creator Credits
- Credit packs sold at complexity-based pricing
- Monthly creator subscription for power users (flat credits per month, cheaper than packs)
- Complexity calculator generates itemized estimate before any credits are consumed

### Bundles
| Bundle | Price |
|--------|-------|
| Companion Basic + Creator | $29.99/mo |
| Companion Premium + Creator | $39.99/mo |
| Companion Custom + Creator | $59.99/mo base + metered |

### Vortex Extension
Free always. Top of funnel acquisition for all paid products.

---

## Knowledge Base Architecture

### Tier 1 — Auto-synced
Top 300 Fallout 4 mods by Nexus download count and endorsements. Synced periodically via Nexus API. Contains: mod name, description, download count, Nexus ID, category, permissions flags. Used for overlap detection before any build starts.

### Tier 2 — Curated Deep Documentation
Top 20-30 mods with active addon ecosystems. Full framework API documentation, record conventions, addon patterns. Required for generating compatible addons. Manually maintained and expanded.

### DLC Records
All 6 Fallout 4 DLC ESP structures loaded as reference. Required for DLC extension mods. Read from user's local game installation.

### Engine Constraint Library
Known impossible or unsupported requests. Hard stops before scoping. Includes: drivable vehicles, multiplayer, flight physics, real-time destructible environments, and others.

### Permissions Cache
Nexus permissions flags per mod. Checked before any derivative work, addon, or inspired-by build proceeds.

---

## Orchestrator Request Pipeline (Creator)

Every mod request flows through this sequence before any build work begins:

1. **Engine constraint check** — is this physically possible in Fallout 4
2. **Overlap detection** — does this already exist well on Nexus
3. **Permissions check** — is derivative work permitted if applicable
4. **DLC/framework detection** — should this extend existing work
5. **Technical decomposition** — break request into components
6. **Complexity calculation** — itemized credit estimate
7. **User approval** — confirm scope and cost before proceeding
8. **Build** — automated ESP, Papyrus, MCM, guided CK steps as needed
9. **Deploy** — via Vortex extension pipeline
10. **Validate** — technical validation before surfacing to user
11. **Test loop** — user tests in game, returns plain English feedback
12. **Repair** — compare against original brief, free fix or credit cost tuning

---

## Open Source Foundations

| Component | Source | Usage |
|-----------|--------|-------|
| F4SE communication pipeline | Mantella (open source) | Blueprint for game↔app communication |
| LIP file generation | FaceFXWrapper (Nukem9, open source) | Real-time LIP generation from audio |
| Companion memory system | MemPalace (MIT, milla-jovovich/mempalace) | Local palace architecture for persistent companion memory — wings, rooms, halls, semantic search, 96.6% recall, zero API calls |
| Vortex extension API | Nexus-Mods/vortex-api | Extension scaffolding and events |
| Nexus API client | @nexusmods/nexus-api (npm) | Mod metadata, permissions, download URLs |

---

## V2 Roadmap (Post Launch)
- Custom voice pipeline for mod creator (user-submitted VO with full conversion and LIP sync)
- Asset ingestion with legal declaration framework
- Additional game support beyond Fallout 4 (Skyrim SE natural bridge)
- Expanded Tier 2 knowledge base coverage

---

## GitHub Workflow

- `main` — production, protected, no direct pushes
- `dev` — integration branch
- `feature/[slug]` — per-feature branches, PR into dev
- `release/[version]` — cut from dev, merge into main

CI runs on every PR: lint → typecheck → test → build.
Deployments trigger automatically on merge to `main`.

---

## Shared Resources

### API Keys — Required in .env
```
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXUS_API_KEY=
DATABASE_URL=
JWT_SECRET=
```

### Shared Utilities
```
packages/shared/
├── api/         ← REST API and WebSocket server
├── auth/        ← Nexus SSO only, no separate accounts, JWT sessions, Stripe customer tied to Nexus user ID
├── billing/     ← Stripe subscriptions, metered billing, pre-auth
└── db/          ← Prisma schema, migrations, models
```

---

## Authentication

Nexus Mods SSO is the sole login method. No separate Strong Tower Mods accounts exist.

- User clicks "Login with Nexus Mods" — no signup form, no separate registration
- Nexus SSO websocket flow issues JWT session token on confirmation
- Stripe customer created automatically on first login, tied to Nexus user ID
- User's Nexus premium status inherited — affects API rate limits (600 req/day premium vs 300 free)
- Nexus username, avatar, and mod history available at login for personalization
- Requires Nexus API SSO registration approval before public launch — use personal API keys during development

---

## Automation Assumptions
- Everything is automated unless explicitly noted as human-handled
- All long-running tasks are async with state written to `state/`
- Agents are stateless — all context passed explicitly per invocation
- Errors surface to notification channel configured in `.env`
- No manual steps in the critical path
- Knowledge base tier 1 sync is fully automated via Nexus API
- Stripe session pre-authorization fires before every Custom companion session
- Technical mod validation runs automatically before user is notified of completion

---

## Code Standards
- TypeScript strict mode — no `any`, explicit return types
- Naming: kebab-case files, PascalCase classes/types, camelCase functions, UPPER_SNAKE_CASE constants
- Formatting: Prettier, single quotes, semicolons, 2-space indent, 100 char line width
- Imports: external libs → internal utils → services → types
- Async: always async/await, never callbacks
- Errors: custom error classes per domain
- F4SE plugin: C++ following existing F4SE plugin conventions
- ESP manipulation: direct binary record manipulation, no xEdit GUI dependency

---

## Initialization Checklist
- [ ] Clone repo and run `npm install`
- [ ] Copy `.env.example` → `.env` and fill in all values
- [ ] Create Nexus Mods account at nexusmods.com
- [ ] Generate personal Nexus API key from account settings (development use only)
- [ ] Contact support@nexusmods.com for SSO registration approval before public launch
- [ ] Set up Stripe account, configure webhook endpoint
- [ ] Set up ElevenLabs account, select/clone companion voice
- [ ] Run `bash ~/.claude/hooks/session-start.sh "strong-tower-mods" "$(pwd)"`
- [ ] Verify agents load correctly
- [ ] Confirm CI pipeline is green
- [ ] Pull Mantella repo locally — study F4SE pipeline before companion build begins
- [ ] Pull FaceFXWrapper repo locally — study before lip sync implementation begins
- [ ] Install MemPalace locally — `pip install mempalace` — study palace architecture before companion memory build begins
