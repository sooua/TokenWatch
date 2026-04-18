# Changelog

All notable changes to TokenWatch are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-v0.1.0 history is the CCSeva lineage ([Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva)) — TokenWatch forked from v1.3.0.

## [Unreleased]

## [0.5.1] — 2026-04-18
### Fixed
- **"Check for updates now" silent failure** — the button fired an IPC
  and then showed nothing on the happy path. `UpdateBanner` only
  rendered for `available / downloading / downloaded / error`, so a
  successful "already on latest" result was swallowed and the user
  interpreted it as broken. The button now toasts a checking spinner,
  then success ("you are on the latest version"), error, or falls
  silent only when the banner itself will take over.
- **Dark mode hardcoded colours** — swept 60+ occurrences across
  Dashboard / Analytics / LiveMonitoring / SettingsPanel /
  ErrorBoundary / CodexCard / Tooltip / Select / Popover / Switch
  that used `bg-neutral-900/80`, `text-white`, `#faf9f5`, `#141413`
  etc. and replaced them with the semantic CSS variables
  (`var(--ivory)`, `var(--claude-black)`, `var(--cream)`, etc.)
  so they flip correctly when the theme switches. Terminal view is
  intentionally left dark — it's designed as a terminal panel.
- **CI lockfile** — sharp / png2icons / vitest installations on
  Windows did not record their Linux-specific optional deps in
  `package-lock.json`. Regenerated with `--include=optional` so
  `npm ci` on `ubuntu-latest` succeeds.

## [0.5.0] — 2026-04-18
### Added
- **Dark mode** — warm ink dark palette ("library at dusk", not neon
  black) driven by `next-themes`. Settings → Theme lets users pick
  System / Light / Dark. Preference persists to `localStorage` as
  `tokenwatch-theme`.
- **Automated tests (Vitest)** — 17 tests across `ccusage-utils`
  (timezone-aware ISO formatting, plan detection, token limits, burn
  rate) and `SettingsService` (load/save round-trip, partial merge,
  backfill from defaults, corrupted-file recovery). CI now runs
  `npm test` on every push and PR.
- **CHANGELOG.md** — Keep a Changelog format, back-filled from v0.1.0.
- **README** — dedicated Linux install section, updated cross-platform
  badges, clarified unsigned-binary warnings for all three OSes.

### Changed
- Extracted pure helpers (`toISOStringLocal`, `detectPlan`,
  `getTokenLimit`, `calculateBurnRate`) from `CCUsageService` into
  `ccusage-utils.ts` so they can be unit-tested without spinning up
  the singleton or a worker thread.

## [0.4.0] — 2026-04-18
### Added
- Cross-platform release pipeline: the GitHub `Release` workflow now builds
  Windows (NSIS installer + portable exe), macOS (universal dmg — x64 +
  arm64), and Linux (AppImage) in parallel on every `v*` tag and attaches
  all artifacts to the same GitHub Release.
- `scripts/make-icons.mjs` now also emits `assets/icon.icns` via `png2icons`
  (pure JS — works on Windows / Linux CI with no Apple toolchain) plus a
  1024 px `assets/icon.png` for Linux AppImage hicolor expansion.
- `dist:linux` npm script.

### Fixed
- `assets/icon.icns` had stayed on the pre-V13 logo; macOS builds now ship
  the correct brand mark.
- `electron-builder.json` `linux.icon` switched from `.icns` to `.png`.

## [0.3.0] — 2026-04-18
### Added
- New brand identity: **V13 Tally Five** — four ink verticals crossed by a
  terracotta diagonal, mapping directly to "tokens accruing". Replaces the
  placeholder terracotta "T" disc across the app, tray icon, installer
  icon, and loading screen.
- `assets/logo.svg` canonical source + `scripts/make-icons.mjs` sharp-based
  generator with per-size stroke tuning (16 px tray stays legible, 1024 px
  installer stays clean).

### Changed
- Header lockup is now a single editorial line: logo · title · tagline on
  one baseline; tighter gap; 40 px SVG mark.

## [0.2.0] — 2026-04-18
### Added
- **Codex CLI monitoring** (opt-in). A second dashboard card shows OpenAI
  Codex rate limits (primary 5 h + secondary 7 d windows), context window
  utilisation, and last-session tokens. Reads `~/.codex/sessions/**/*.jsonl`
  directly — no estimation, no API calls. Off by default; toggle in Settings.
- **Auto-updates** via `electron-updater`: checks GitHub Releases on launch
  and every 4 h, shows an update banner, and never starts a download
  without user consent. Settings panel has a manual "check for updates now"
  button.

### Changed
- `electron-builder` no longer tries to auto-publish during local `dist`
  runs — avoids the "GitHub Personal Access Token is not set" CI prompt.
  CI uses `softprops/action-gh-release@v2` for attachment.

## [0.1.0] — 2026-04-17
### Added
- Full rename and rebrand: **CCSeva → TokenWatch**. New app identifiers,
  Windows AppUserModelID, tray/window titles, i18n copy.
- Complete UI redesign in the Claude / Anthropic warm-parchment design
  language: serif display type, terracotta accents, ring shadows instead
  of drop shadows, parchment canvas.
- **Frameless window** with custom minimise / maximise / close controls
  drawn in React; whole header strip is a drag region.
- **Mini HUD**: opt-in always-on-top floating panel (220 × 64 px, top-right
  by default, draggable). Three content modes — percentage only, +cost,
  +cost+burn rate.
- **Timezone-aware "today"** aggregation (previous UTC rollover could
  empty the model distribution card around midnight).
- **Double circular ring** in the Dashboard hero — usage percentage + reset
  countdown, same visual component, colour-tinted per state.
- **i18n**: English + 简体中文 with auto-detect via `navigator.language`.
- **GitHub Actions**: `ci.yml` (Ubuntu lint/typecheck/build) +
  `release.yml` (Windows installer build on `v*` tags).
- **Single-instance lock** (`app.requestSingleInstanceLock`) — relaunching
  surfaces the existing window instead of stacking tray icons.
- **Launch-on-startup** and **standalone window** toggles.
- **Windows port** with EPIPE-safe stdout/stderr guards for detached shells.

### Performance
- **Worker-thread ccusage parsing** — session block parsing runs in a
  `worker_threads` worker so the tray and UI stay responsive while large
  histories load.
- **Three ccusage patches** (`patches/ccusage+18.0.8.patch`): skip the
  redundant `sortFilesByTimestamp` call, parallelise file reads with a
  bounded `Promise.all` (32 concurrent), and disk-cache LiteLLM pricing
  at `~/.tokenwatch/pricing-cache.json` with a 24 h TTL. ~4× cold-start
  speedup on large usage histories.
- **Persistent stats cache** at `~/.tokenwatch/stats-cache.json` so a cold
  start paints the full UI from disk immediately, then refreshes in the
  background.
- **Request coalescing** via an in-flight promise + 20 s in-memory cache.

### Forked
- From [Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva)
  v1.3.0. MIT licence preserved.
