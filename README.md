# TokenWatch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4)](#installation)
[![macOS](https://img.shields.io/badge/macOS-10.15%2B-blue)](#installation)
[![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624)](#installation)

A warm, editorial tray app that keeps a quiet eye on your Claude Code token usage. Lives in the system tray on Windows, menu bar on macOS, or indicator area on Linux; shows real-time consumption, cost, and burn rate, and stays out of the way the rest of the time.

## Features

- **Live tray display** — hovering the tray icon shows the current usage percentage and cost; click to open the full view
- **Parchment UI** — warm Claude-inspired design system (serif headings, terracotta accents, ring shadows) instead of the usual cool-grey dashboard look
- **Standalone window mode** — optional normal resizable window with a taskbar entry, in addition to the default tray-anchored popup
- **Instant cold start** — persists the last snapshot to disk so subsequent launches render the full UI immediately, then refresh in the background
- **Worker-thread parsing** — ccusage JSONL parsing runs in a `worker_threads` worker so the tray and UI stay responsive while large histories load
- **Smart plan detection** — auto-detects Pro / Max5 / Max20 / Custom from actual usage, or pick one manually
- **Analytics** — 7-day and 30-day trends as area / line / bar, model distribution donut, per-hour burn rate, plan utilization, depletion prediction
- **Terminal view** — a calm monospace readout for when you just want the numbers
- **Smart notifications** — alerts at 70% and 90% thresholds with cooldown
- **Single-instance lock** — relaunching surfaces the existing window instead of spawning a duplicate tray icon
- **Launch on startup** *(optional)* — starts minimized to the tray when you sign in
- **i18n** — English and 简体中文, auto-detected from the system

## Installation

Download the latest release from [GitHub Releases](https://github.com/sooua/TokenWatch/releases/latest).

### Windows

- **Installer**: `TokenWatch-Setup-<version>-x64.exe` (NSIS, custom install directory, desktop & start-menu shortcuts)
- **Portable**: `TokenWatch-Portable-<version>-x64.exe` (no installation required)

Windows 10 / 11 (x64). Binaries are unsigned — SmartScreen will prompt on first launch; click **More info → Run anyway**.

### macOS

- **Apple Silicon**: `TokenWatch-<version>-arm64.dmg`
- **Intel**: `TokenWatch-<version>.dmg`

macOS 10.15+. Binaries are unsigned — the first launch needs `System Settings → Privacy & Security → Open Anyway`, or from the terminal:

```bash
xattr -cr /Applications/TokenWatch.app
```

### Linux

- **AppImage**: `TokenWatch-<version>.AppImage`

```bash
chmod +x TokenWatch-*.AppImage
./TokenWatch-*.AppImage
```

AppImages are self-contained and portable — no system-wide install, no package manager required.

### Build from source

```bash
git clone <this-repo>
cd tokenwatch
npm install   # also applies patches/ccusage+*.patch via postinstall
npm run build
npm start
```

Packaging:

```bash
npm run dist:mac     # macOS DMG (x64 + arm64 universal)
npm run dist:win     # Windows NSIS installer + portable exe
npm run dist:linux   # Linux AppImage
npm run dist         # Current platform (auto)
```

> **Note**: `npm install` runs `patch-package` on `postinstall` to apply a small local patch to ccusage (`patches/ccusage+18.0.8.patch`). The patch:
>
> 1. **Skips the pre-read file sort** — `loadSessionBlockData` opens and streams every JSONL file just to find its earliest timestamp, then opens each file again to read entries. `identifySessionBlocks` already sorts entries by timestamp internally, so the pre-sort is redundant. Cuts cold-start I/O in half.
> 2. **Parallelizes file processing** — the upstream serial `for (const file of sortedFiles) await processJSONLFileByLine(file, ...)` is replaced with a bounded `Promise.all` (cap: 32 concurrent files) to keep libuv's I/O thread pool busy.
> 3. **Persists LiteLLM pricing to disk** — the upstream fetcher re-downloads pricing from GitHub on every run. We cache the response at `~/.tokenwatch/pricing-cache.json` with a 24h TTL and skip the network round-trip when the cache is fresh. Cost calculation accuracy is unchanged.
>
> Typical impact on a 1,700-file history: cold start ~49s → ~12–30s depending on disk cache state. Subsequent runs also avoid the 1–5s LiteLLM fetch.

#### Windows packaging prerequisites

`electron-builder` creates symbolic links while extracting the `winCodeSign` helper on Windows. If the build fails with `Cannot create symbolic link : 客户端没有所需的特权` (or similar), enable one of the following:

1. **Windows Developer Mode** *(recommended)*: Settings → Privacy & security → For developers → turn on **Developer Mode**, then rerun `npm run dist:win`.
2. Run the terminal as Administrator and rerun the build.

If a prior failed build left a bad cache, delete it and retry:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
```

We don't ship signed Windows binaries; unless you set your own certificate, builds skip code signing automatically (`CSC_IDENTITY_AUTO_DISCOVERY=false` is safe to set if you see signing prompts).

## Usage

1. **Launch** — TokenWatch appears in your menu bar (macOS) or notification area / system tray (Windows)
2. **Left-click the tray icon** — toggle the main window
3. **Right-click the tray icon** — context menu: current usage %, cost, Open, Refresh, Quit
4. **Drag the window** — the header is the drag handle (frameless window with custom Claude-styled controls)

The app reads your Claude Code usage history from `~/.claude/projects/**/*.jsonl` and refreshes every 30 seconds.

### Platform differences

| Behavior | macOS | Windows |
|---|---|---|
| Tray label (% / $) | Rendered as text directly in the menu bar via `Tray.setTitle` | Shown in the tooltip on hover and in the right-click context menu header (Windows tray icons cannot display text) |
| Tray icon | Empty (text-only) | PNG / ICO icon (`assets/tray.ico`) |
| Window chrome | Custom title bar (no native) | Custom title bar with minimize / maximize / close buttons |
| Window anchor | Top-right, near the menu bar | Near the tray icon, clamped to the active display |
| Notifications | Native Notification Center | Toast center (requires `AppUserModelId`, set automatically) |

## Requirements

- macOS 10.15+ **or** Windows 10/11 (x64)
- Node.js 18+ (for building from source)
- Claude Code CLI installed and configured (there must be JSONL logs under `~/.claude/projects`)

## Tech Stack

- Electron 36 + React 19 + TypeScript 5
- Tailwind CSS 3 with a custom Claude-inspired warm palette
- Radix UI primitives
- i18next + react-i18next
- ccusage for usage data (with local performance patches via patch-package)

## Data stored locally

TokenWatch keeps small files under `~/.tokenwatch/`:

- `settings.json` — user preferences (language, plan, display mode, etc.)
- `stats-cache.json` — last-known usage snapshot, used to render the UI instantly on cold start
- `pricing-cache.json` — LiteLLM model pricing table, 24h TTL

Nothing is sent anywhere else — the only network call is ccusage's pricing fetch from GitHub (cached).

## License

MIT License — see [LICENSE](LICENSE).

## Credits

TokenWatch is based on [CCSeva](https://github.com/Iamshankhadeep/ccseva) by **Iamshankhadeep** (MIT). The Windows port, warm-parchment UI redesign, worker-thread parsing, ccusage performance patches, frameless custom title bar, and i18n support were added on top of that foundation.

Built with [Electron](https://electronjs.org), [React](https://reactjs.org), [Tailwind CSS](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com), [lucide-react](https://lucide.dev), and [ccusage](https://github.com/ryoppippi/ccusage).
