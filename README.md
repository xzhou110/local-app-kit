# Local App Kit

The runtime shared by XuSeak's private local apps (career-center, ai-usage-tracker, creator-advisors, x-command-center): a `node:http` server bound to 127.0.0.1 that refuses foreign Host headers, writes JSON files atomically with a Windows rename retry, hands out content-hash ETags and answers 412 when a file changed under an editor, watches the data folder and pushes one Server-Sent Events stream to the browser, and holds a `server.lock` so only one daily server runs. Every module was lifted from the app that already had the behaviour and its tests; nothing was redesigned.

## Install

In a consumer, pin a tag (never a branch), then commit the lockfile:

```
npm install "git+https://github.com/xzhou110/local-app-kit.git#v0.1.0"
```

Node 24 or newer. `npm ci` resolves the pinned commit from the lockfile; no registry account, no token. A kit change reaches an app only when that app bumps the tag and passes its own `npm run check`.

## Use

```ts
import { acquireServerLock, createEventHub, createOwnWrites, createStaticHandler, listenLoopback, watchDirs } from '@xuseak/local-app-kit';

const lock = await acquireServerLock('local', { port: 8150, appName: 'Career Center' });
if (!lock.ok) { console.error(lock.message); process.exit(1); }
const ownWrites = createOwnWrites();
const hub = createEventHub();
watchDirs(root, ['data'], paths => hub.broadcast('changed', { paths }), { ownWrites });
const handler = createStaticHandler({ dist: 'dist', port: 8150, api: myApiHandler });
const server = await listenLoopback({ port: 8150, handler });
```

Each module is importable on its own (`@xuseak/local-app-kit/atomic-write`). Every expected failure comes back as a value (`{ ok: false, reason, status }`); the app maps it to its own error envelope and wording. Nothing throws for a file-system or network condition, only for a programmer error.

## Modules

| Module | What it does |
|---|---|
| `atomic-write` | `writeAtomic(file, text, { ifMatch, ownWrites })`: temp file beside the target, rename with an EPERM/EACCES/EBUSY retry (6 attempts, 10 to 320 ms), the If-Match check re-run before every rename attempt, a per-path mutex, the own-write ledger; `readWithEtag`, `deleteFile`, `appendLine`, `listTree`. Without `ifMatch` a write only creates; `'*'` overwrites. |
| `etag` | `sha256`, `quoteEtag`, `parseIfMatch` (quoted, weak and `*` forms). |
| `safe-path` | `safeUnder`, `safeRealUnder` (containment through junctions), `canonicalFile` (one identity for case, dot-segment and alias forms; Win32 trailing dots, spaces and streams refused). |
| `watch` | `watchDirs(root, dirs, onBatch, { ownWrites, debounceMs })`: recursive watch, one batch per burst, own writes suppressed, temp files ignored, re-arms on error. |
| `sse` | `createEventHub()`: `open(req, res)`, `broadcast(event, data)`, heartbeat comments, a full client is closed so it reconnects. |
| `security` | `hostAllowed`, `originAllowed`, `checkMutation` (custom header, same-origin Origin, optional JSON content type), `DEFAULT_CSP`, `buildCsp`, `securityHeaders`. |
| `request-target` | `parseRequestTarget(req.url, port)`: 400 for every target that once crashed or fooled a server (`//`, `/%zz`, `..%5c`, `%2e%2e`, `C:`, `::$DATA`, `NUL.txt`, trailing dot or space, double encoding, control characters). |
| `json-body` | `readBody`, `readJsonBody(req, limit, { allowEmpty, objectOnly })`: 413 while draining an oversized body, 400 for malformed JSON without echoing it. |
| `static-handler` | `createStaticHandler({ dist, port, api, fallback, csp, assetCache, headers })`: Host 403, target 400, `/api/*` to the app, 503 when `dist/` is missing, SPA fallback (hash router or a route set), realpath containment, `index.html` never cached, HEAD mirrors GET, other methods 405. |
| `server-lock` | `acquireServerLock(dir, { port, appName })`: `server.lock` with a recovery guard so simultaneous stale-lock recoveries elect exactly one owner; idempotent release; never kills a process. `readServerLock` for launchers. |
| `serve` | `listenLoopback({ port, handler })`: 127.0.0.1 only, malformed requests answer 400, a taken port is a clear result; `installCrashGuards`, `parsePort`. |

## Behaviour Notes

Where the four copies disagreed, the kit keeps one behaviour. The differences an app sees when it migrates:

- A request target with a dot segment or double encoding (`/%2e%2e/x`, `/../x`) answers 400 before URL normalisation; career-center's static handler answered 404 after it. Both refuse.
- `writeAtomic` without `ifMatch` only creates (career-center's rule); an app that means "overwrite" passes `'*'`.
- A non-GET method on a static path answers 405 with `Allow: GET, HEAD` (creator-advisors' rule); career-center served any method.
- The Origin check accepts all three loopback forms on the bound port; ai-usage-tracker's accepted only the one equal to its Host header.
- A deletion is announced by the watcher as well as by the API that deleted (as in career-center); a deleted file has no ETag to match the ledger.

## Develop

```
npm install
npm run check      # lint, typecheck, tests (module tests and the parity suite), build, dist freshness
```

`parity/consumers.test.ts` assembles two small apps the way the consumers assemble theirs and proves, over a real socket, every behaviour they rely on; each test is named after the consumer test it was lifted from. `dist/` is committed because a consumer installs this package from a git tag and runs `dist/` (Node refuses to strip types under `node_modules`); `check` fails when `dist/` is stale.

## Release

A release is `npm version <patch|minor|major>` run beside package.json: it stamps the Unreleased section of `CHANGELOG.md` with the version and date (`scripts/changelog-release.mjs`), commits and tags `v<version>`; then `git push --follow-tags`. Consumers pin that tag.

## Upkeep

Dependabot opens one grouped pull request a month for minor and patch updates (`.github/dependabot.yml`); the `check` workflow tests it, so merging is a review of a green run. `npm run audit:deps` reports known vulnerabilities in the dependencies that ship (none: the kit has no runtime dependency); the `audit` job runs it on every push and never blocks.

Built to the shared engineering standard: `D:/Meaningful/AI/agent-skills/rules/engineering-principles.md`.
