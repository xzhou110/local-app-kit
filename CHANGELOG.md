# Changelog

What changed in each release, written for people (principle 9 of `D:/Meaningful/AI/agent-skills/rules/engineering-principles.md`). Newest first. A release is `npm version <patch|minor|major>` run beside package.json: it stamps the Unreleased section with the version and date (`scripts/changelog-release.mjs`), commits and tags `v<version>`; then `git push --follow-tags`. Consumers pin that tag.

## Unreleased

- First version: the server runtime lifted from career-center, ai-usage-tracker, creator-advisors and x-command-center. Modules: `atomic-write` (temp file, Windows rename retry, If-Match conflict check before every rename, per-path mutex, own-write ledger), `etag`, `safe-path` (containment through junctions), `watch` (debounced recursive watch with own-write suppression), `sse` (one event hub), `security` (Host, Origin and mutation checks, a strict default CSP), `request-target` (400 for every request target that used to crash a server), `json-body` (size limit that keeps the socket alive), `static-handler` (guarded static files with SPA fallback), `server-lock` (single instance with safe stale recovery), `serve` (loopback listener with crash guards). A parity suite proves the behaviours the four apps rely on over a real socket.
