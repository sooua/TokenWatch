# CCSeva 🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/Iamshankhadeep/ccseva.svg)](https://github.com/Iamshankhadeep/ccseva/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Iamshankhadeep/ccseva/ci.yml?branch=main)](https://github.com/Iamshankhadeep/ccseva/actions)
[![Downloads](https://img.shields.io/github/downloads/Iamshankhadeep/ccseva/total.svg)](https://github.com/Iamshankhadeep/ccseva/releases)
[![macOS](https://img.shields.io/badge/macOS-10.15%2B-blue)](https://github.com/Iamshankhadeep/ccseva)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4)](https://github.com/Iamshankhadeep/ccseva)

A beautiful menu bar / tray app for tracking your Claude Code usage in real-time. Monitor token consumption, costs, and usage patterns with an elegant interface.

## Screenshots

![Dashboard](./screenshots/dashboard.png)
![Analytics](./screenshots/analytics.png)
![Terminal](./screenshots/terminal.png)

## Features

- **Real-time monitoring** - Live token usage tracking with 30-second updates
- **Menu bar / tray integration** - Percentage indicator with color-coded status (macOS); hover tooltip + dynamic context menu (Windows)
- **Smart plan detection** - Auto-detects Pro/Max5/Max20/Custom plans
- **Usage analytics** - 7-day charts, model breakdowns, and trend analysis
- **Smart notifications** - Alerts at 70% and 90% thresholds with cooldown
- **Cost tracking** - Daily cost estimates and burn rate calculations
- **Instant cold start** - Persists the last snapshot to disk so subsequent launches render the full UI immediately, then refresh in the background
- **Single-instance lock** - Relaunching the app surfaces the existing window instead of opening a second tray icon
- **Launch on startup** *(optional)* - Start CCSeva minimized to the tray when you sign in (Settings → Launch on Startup)
- **Standalone window mode** *(optional)* - Switch the tray popup to a normal resizable window with a taskbar entry (Settings → Standalone Window)
- **Worker-thread parsing** - ccusage JSONL parsing runs in a `worker_threads` worker so the tray and UI stay responsive while large histories load
- **Beautiful UI** - Gradient design with glass morphism effects

## Installation

### macOS

Download the latest release from [GitHub Releases](https://github.com/Iamshankhadeep/ccseva/releases):
- **Apple Silicon**: `CCSeva-darwin-arm64.dmg`
- **Intel**: `CCSeva-darwin-x64.dmg`

### Windows

Download the latest release from [GitHub Releases](https://github.com/Iamshankhadeep/ccseva/releases):
- **Installer**: `CCSeva-Setup-<version>-x64.exe` (NSIS, supports custom install directory)
- **Portable**: `CCSeva-Portable-<version>-x64.exe` (no installation required)

Windows 10 / 11 (x64) are supported.

### Build from Source

```bash
git clone https://github.com/Iamshankhadeep/ccseva.git
cd ccseva
npm install   # applies patches/ccusage+*.patch via postinstall
npm run build
npm start
```

> **Note**: `npm install` runs `patch-package` on `postinstall` to apply a small local patch to ccusage (`patches/ccusage+18.0.8.patch`). The patch does three things:
>
> 1. **Skip the pre-read file sort** — `loadSessionBlockData` was opening and streaming every JSONL file just to find its earliest timestamp, then opening each file again to read entries. `identifySessionBlocks` already sorts entries by timestamp internally, so the pre-sort is redundant. Cuts cold-start I/O in half.
> 2. **Parallelize file processing** — the upstream serial `for (const file of sortedFiles) await processJSONLFileByLine(file, ...)` is replaced with a bounded `Promise.all` (cap: 32 concurrent files) to keep libuv's I/O thread pool busy.
> 3. **Persist LiteLLM pricing to disk** — the upstream fetcher re-downloads pricing from GitHub on every run. We cache the response at `~/.ccseva/pricing-cache.json` with a 24h TTL and skip the network round-trip when the cache is fresh. Cost calculation accuracy is unchanged.
>
> Typical impact on a 1,700-file history: cold start ~49s → ~12–30s depending on disk cache state. Subsequent runs also avoid the 1–5s LiteLLM fetch.

Packaging:

```bash
npm run dist:mac   # macOS DMG
npm run dist:win   # Windows NSIS installer + portable exe
npm run dist       # Current platform (auto)
```

#### Windows packaging prerequisites

`electron-builder` creates symbolic links while extracting the `winCodeSign` helper on Windows. If the build fails with `Cannot create symbolic link : 客户端没有所需的特权` (or similar), enable one of the following:

1. **Windows Developer Mode** *(recommended)*: Settings → Privacy & security → For developers → turn on **Developer Mode**, then rerun `npm run dist:win`.
2. Run the terminal as Administrator and rerun the build.

If a prior failed build left a bad cache, delete it and retry:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
```

We don't ship signed Windows binaries; unless you set your own certificate, builds skip code signing automatically (`CSC_IDENTITY_AUTO_DISCOVERY=false` is safe to set if you see signing prompts).

### Development

```bash
npm run electron-dev  # Watch build + launch Electron with reload
```

## Usage

1. **Launch** - CCSeva appears in your menu bar (macOS) or notification area / system tray (Windows).
2. **Left-click the tray icon** - Toggle the main window.
3. **Right-click the tray icon** - Context menu: current usage %, cost, Open, Refresh, Quit.

The app automatically detects your Claude Code configuration from the `~/.claude` directory (Windows: `%USERPROFILE%\.claude`) and refreshes every 30 seconds.

### Platform differences

| Behavior | macOS | Windows |
|---|---|---|
| Tray label (% / $) | Rendered as text directly in the menu bar via `Tray.setTitle` | Shown in the tooltip on hover and in the right-click context menu header (Windows tray icons cannot display text) |
| Tray icon | Empty (text-only) | PNG / ICO icon (`assets/tray.ico`) |
| Window anchor | Top-right, near the menu bar | Near the tray icon, clamped to the active display |
| Notifications | Native Notification Center | Toast center (requires `AppUserModelId`, set automatically by the app) |

## Requirements

- macOS 10.15+ **or** Windows 10/11 (x64)
- Node.js 18+ (for building from source)
- Claude Code CLI installed and configured (there must be JSONL logs under `~/.claude/projects`)

## Tech Stack

- Electron 36 + React 19 + TypeScript 5
- Tailwind CSS 3 + Radix UI components
- ccusage package for data integration

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Built with ❤️ using [Electron](https://electronjs.org), [React](https://reactjs.org), [Tailwind CSS](https://tailwindcss.com), and [ccusage](https://github.com/ryoppippi/ccusage).

---

**Note**: This is an unofficial tool for tracking Claude Code usage. Requires a valid Claude Code installation and configuration.
