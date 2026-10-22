---
name: local-app-kit
summary: "The runtime shared by XuSeak's private local apps: atomic JSON writes with ETags, localhost-only HTTP guards, a guarded static handler, one SSE hub and the single-instance server lock, consumed as a git dependency pinned to a tag"
status: active
live: none
repo: https://github.com/xzhou110/local-app-kit
updated: 2026-10-22
category: ai-tooling
phase: building
next: migrate creator-advisors to v0.1.0 (security.ts, static.ts, main.ts) behind its own npm run check, then career-center, then x-command-center
---

# Local App Kit

## 1. Summary
Four private local apps (career-center, ai-usage-tracker, creator-advisors, x-command-center) ran the same runtime from their own copies: six atomic-write helpers, two full servers with ETag, lock and Host checks, two `security.ts` files copied from the `local-private-app` skill and diverged. Principle 10 of the engineering standard says the third consumer earns a shared package. This is it: one TypeScript package with its own tests and a parity suite that proves, over a real socket, every behaviour the four apps rely on, released as a `v<version>` tag that each app pins as a git dependency. Status: v0.1.0 released on 2026-10-22 and consumed by ai-usage-tracker (its server runtime, verified by its check, its GitHub gate and its real Start-entry launch); three consumers to go.

## 2. Key facts
| | |
|---|---|
| **Kind** | tool · shared package (a library, no UI, no data) |
| **Stack** | TypeScript 6 source compiled to ESM JavaScript plus `.d.ts` in a committed `dist/`; Node 24; tests with `node --test` on the `.ts` files; ESLint with the standard's boundaries; zero runtime dependencies |
| **Local path** | `D:\Meaningful\AI\local-app-kit` |
| **Run** | `npm run check` (lint, typecheck, module tests and the parity suite, build, dist freshness); `npm test` alone for the tests |
| **Deploy** | none to run. A release is `npm version <patch\|minor\|major>` (stamps `CHANGELOG.md`, commits, tags `v<version>`) then `git push --follow-tags`; consumers bump their pinned tag |
| **Data / backends** | none; every test fixture is a synthetic temp folder; $0 |
| **Related** | consumers: ai-usage-tracker (first), creator-advisors, career-center, x-command-center; origin of the code: the `local-private-app` skill's `references/` (career-center's real files) and ai-usage-tracker's lock and guard |
| **Started · last major change** | 2026-10-22 · 2026-10-22 |

## 3. Key things to know
- **Consumers pin a tag, never a branch:** `"@xuseak/local-app-kit": "git+https://github.com/xzhou110/local-app-kit.git#v0.1.0"`. A kit change reaches an app only when that app bumps the tag and passes its own `npm run check`; releases stay uncoupled (principle 10's "premature sharing couples releases").
- **`dist/` is committed and gated.** Node refuses to strip types under `node_modules`, so the package ships JavaScript; `npm run check` fails when `dist/` is stale. Edit `src/`, run `npm run build`, commit both.
- **Failures are values**, never throws: `{ ok: false, reason, status }` from every module. An app maps them to its own error envelope and user wording; the kit carries no app's error type.
- **Lifted, not redesigned.** Each module came from the copy that had the behaviour and the tests; the parity suite (`parity/consumers.test.ts`) names the consumer test each row was lifted from. Where the copies disagreed, the stricter rule won and `README.md` Behaviour Notes lists what a migrating app sees change.
- **First version is the server runtime only.** The browser client, the Electron shell commons and the launchers are later candidates (`DECISIONS.md`); none is shared until a second app needs it in the same shape.
- **The kit is adapter-layer code**: no engine folder, by decision; the audit's engine row is N/A.
- **Private data never enters here**: no app data, no `local/`, `private/` or `data/` folder of any consumer is read by the kit or its tests.
- **Toolchain:** TypeScript 6 for the kit's own build and lint (typescript-eslint supports below 6.1); the consumers' TypeScript 7 reads the emitted `.d.ts`.

## 4. Details
### How it works
`src/` holds one module per concern, each with its test beside it: `atomic-write` (temp file, rename retry, If-Match re-check before every rename, per-path mutex, own-write ledger), `etag`, `safe-path` (containment through junctions, Win32 aliases), `watch` (debounced recursive watch, own-write suppression), `sse` (one event hub), `security` (Host, Origin, mutation header, JSON, CSP), `request-target` (400 for every target that used to crash a server), `json-body` (413 while draining), `static-handler` (the guarded listener: static files plus `/api/*` dispatch), `server-lock` (single instance with a recovery guard), `serve` (loopback listener, crash guards). `src/index.ts` re-exports everything; `package.json` `exports` also names each module. `tsc -p tsconfig.build.json` emits `dist/` (ESM `.js` and `.d.ts`, relative `.ts` imports rewritten to `.js`).
```
local-app-kit/
├─ src/<module>.ts + <module>.test.ts   the runtime and its unit tests; test-support.ts (helpers, not packaged)
├─ parity/consumers.test.ts             two apps assembled the consumers' way, proven over a real socket
├─ dist/                                 the committed build consumers run
├─ scripts/{check-dist.mjs, changelog-release.mjs}   the dist gate; the npm version hook
├─ .github/{workflows/check.yml, dependabot.yml}     the gate and the audit job on every push; monthly grouped updates
└─ PROJECT.md DECISIONS.md CHANGELOG.md README.md
```

### How to work on it
Edit `src/` → `npm run check` → commit (with `dist/`) → push (the global pre-push hook runs `check` again; GitHub Actions runs it on every push). A behaviour an app relies on gets its row in the parity suite before the app migrates. To release: write the Unreleased lines in `CHANGELOG.md`, `npm version <patch|minor|major>`, `git push --follow-tags`. To migrate an app: make its `npm run check` real first, add the dependency pinned to the tag, swap one module at a time behind green tests, delete the old file, write the app's `DECISIONS.md` entry, check its everyday launch, push.

### Current state & open items
v0.1.0: 64 tests green locally, in a fresh clone and in the GitHub gate; installed from the tag into a scratch consumer under Node 24 and TypeScript 7 and 6. **Migrated:** ai-usage-tracker (2026-10-22: `server/atomic.ts` and `server/lock.ts` removed, `server/http.ts` on the kit's guards, body reader, SSE hub, static handler and listener; 88 tests, its GitHub `check` run fetched the pinned tag on a clean runner, the Start-entry launch, repeat launch and stale-lock recovery verified live). **Open, in this order, each its own session of small commits:** creator-advisors (`server/security.ts`, `static.ts`, `main.ts`; read-only, four server tests as the acceptance; its `npm run check` must be made real first), career-center (`server/fs.ts`, `security.ts`, `static.ts`, the lock in `main.ts`; the private-data app, deeper review tier; its static test expects 404 for `/%2e%2e/x`, which becomes 400), x-command-center (JavaScript: the four atomic helpers and the Host and Origin check; its allow-listed static routes, service identity and collection lock stay). Later candidates: the browser client, the Electron shell commons, the launchers. Open for the owner: a license for the public repository (today `UNLICENSED`); lint in the TypeScript 7 apps (typescript-eslint supports below 6.1) is a fleet-wide choice. Dependabot alerts and security updates are switched on for this repository; its first grouped update pull requests arrived on creation and are the owner's to merge after a green check.

### Change highlights
- 2026-10-22 — Project set up; the plan approved (option A: git dependency pinned to a tag, public repository, committed `dist/`); the kit written from the four copies with 64 tests including the parity suite; v0.1.0 cut, the repository made public after a clean history scan; ai-usage-tracker migrated and verified live.

## 5. Pointers
- [README.md](README.md) — install, use, the modules, behaviour notes, release and upkeep
- [DECISIONS.md](DECISIONS.md) — dated decisions and the why, newest first
- [CHANGELOG.md](CHANGELOG.md) — what each release changed
- [parity/consumers.test.ts](parity/consumers.test.ts) — the behaviours the consumers rely on, one row each
- The plan the owner approved (2026-10-22): the side-session note `local-app-kit-plan.md` of the session that started this work; the standard: `D:/Meaningful/AI/agent-skills/rules/engineering-principles.md`, principle 10; the origin of the code: `D:/Meaningful/AI/agent-skills/skills/local-private-app/references/`
