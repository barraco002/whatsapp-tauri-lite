<img src="assets/whatsapp-tauri.svg" alt="logo" align="left" width="64" height="64">

# WhatsApp Tauri Lite

**A WhatsApp desktop window in 6 MB, not 200.** Native window, the WebView your system already has, no bundled Chromium.

[![Release](https://img.shields.io/github/v/release/barraco002/whatsapp-tauri-lite?label=download&color=brightgreen)](https://github.com/barraco002/whatsapp-tauri-lite/releases/latest)
[![Stars](https://img.shields.io/github/stars/barraco002/whatsapp-tauri-lite?style=flat&color=yellow)](https://github.com/barraco002/whatsapp-tauri-lite/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#installation)
[![Binary](https://img.shields.io/badge/binary-6.25%20MiB%20(%E2%88%9248.5%25)-brightgreen)](BENCHMARKS.md)

<img src="assets/social-preview.png" alt="WhatsApp Tauri Lite: 6.25 MiB binary, 2.00 MiB installer, 175 ms cold start" width="100%">

```
Typical Electron WhatsApp wrapper   ████████████████████████████████████████  ~200 MB
Discord                             ███████████████████████████████████████  ~180 MB
This app                            ████                                       6.25 MB
```

---

## What it looks like

<img src="assets/screenshot.png" width="760" alt="The app open on first run: a native window titled Whatsapp Tauri, showing WhatsApp Web asking to link a device">

First run, empty profile: no account linked, no history, nothing preinstalled. The window is the whole product - there is no custom UI to show you, because there isn't one.

## Why this exists

Most WhatsApp desktop wrappers ship an entire Chromium build to render one web page. That is 180-200 MB of disk and
hundreds of megabytes of RAM for a chat window that never leaves `web.whatsapp.com`.

This one uses **Tauri v2** and the WebView the operating system already has (WebView2 on Windows). Nothing is bundled
but the window itself: the installer is **2.00 MiB**, the binary is **6.25 MiB**, and the window is visible **175 ms**
after launch.

The release profile in this build was tuned with measurements instead of vibes: fat LTO plus `codegen-units = 1` cut
the binary **48.5 %** with no measurable cost in startup, memory or frame pacing. The two variants that made it smaller
and were still rejected - `opt-level = "s"` and `"z"` - are documented with their numbers in
[BENCHMARKS.md](BENCHMARKS.md).

## What it is not

It is **not** a WhatsApp client. It is a window around WhatsApp Web: your messages still go through WhatsApp the same
way they do in a browser tab. There is no separate login, no protocol reimplementation, no proxy in the middle.

- No E2E implementation of its own. Whatever WhatsApp Web does, this does.
- No offline mode. It needs a connection, exactly like the web app.
- No Linux binaries published yet. The source is portable, but Releases currently carries the Windows installer only.
- An unofficial client. Not affiliated with WhatsApp or Meta. Use at your own risk.

## Features

- Native window and tray - no Chromium, no Electron runtime
- Global shortcut `Ctrl + Alt + W` to show/hide
- Optional auto-start with the system
- Native dark title bar and menus on Windows
- Downloads with sanitised filenames (reserved Windows names, duplicate handling)
- Deep links (`whatsapp://`), single-instance lock, native notifications

## Installation

**Windows** (Windows 10/11, WebView2 is preinstalled on both):

1. Grab `Whatsapp.Tauri_0.3.3_x64-setup.exe` from [**Releases**](https://github.com/barraco002/whatsapp-tauri-lite/releases/latest)
2. Run it. It installs for the current user - no admin prompt
3. Log in by scanning the QR with your phone, as usual

SHA-256 of the installer: `a389e6e7b8ad242f47412bef099735dceb8818398c1f3358d8ef8a389ca304c4`

```powershell
(Get-FileHash ".\Whatsapp.Tauri_0.3.3_x64-setup.exe" -Algorithm SHA256).Hash.ToLower()
# a389e6e7b8ad242f47412bef099735dceb8818398c1f3358d8ef8a389ca304c4
```

**Linux**: no binaries in Releases yet. Build from source (see below); the Tauri config targets WebKitGTK.

**No install at all**: the browser sibling,
[**WhatsApp Web Deluxe**](https://github.com/barraco002/whatsapp-web-deluxe), opens the
same website in a Chrome popup window with an unread badge on the toolbar. 11 KB, no
content script, no network requests, no analytics. It is not a replacement for this
app - it is what you use on a machine where you cannot install anything.

## Numbers (measured, not estimated)

| | value |
|---|---:|
| Installer (NSIS) | **2.00 MiB** |
| Binary | **6.25 MiB** |
| Cold start to visible window | **175 ms** (median of 10 runs) |
| Cold start to WebView ready | 692 ms |
| Idle RSS (including the WebView2 processes) | 845 MiB |
| Idle CPU | ~1 % |
| Frame pacing | 75 fps, p95 13.4 ms |

Same machine, same harness, raw dumps committed in [`perf/out/`](perf/out). Reproduce with `perf/measure.ps1`.
The caveats are written down, not hidden: the 845 MiB is 96 % WebView2 (the native process is 32 MiB), first paint is
network-bound and not a fair comparison, and "cold" means warm disk cache. See
[BENCHMARKS.md](BENCHMARKS.md#what-is-not-claimed-here).

## Building from source

Requirements: Rust + Cargo, Node.js, and on Windows the MSVC build tools and Windows SDK; on Linux, WebKit2GTK.

```bash
git clone https://github.com/barraco002/whatsapp-tauri-lite.git
cd whatsapp-tauri-lite/whatsapp-lite
npm install
npm run dev      # development window (tauri dev)
npm run build    # release binary + installer
```

On Windows without Visual Studio installed, the portable MSVC + Windows SDK in
`D:\dev\BuildTools` is enough — but the Tauri build script needs `rc.exe` and the
SDK headers on the environment, or it aborts with *"Are you sure you have RC.EXE in
your $PATH"*. Both entry points resolve that environment for you:

- `npm run dev` / `npm run build` go through `scripts/tauri.mjs`, which finds the
  newest MSVC and SDK, sets `RUSTUP_HOME`, `CARGO_HOME`, `RC`, `LIB`, `INCLUDE`
  and `PATH`, then launches `@tauri-apps/cli`.
- `scripts/build-msvc.ps1` does the same for bare cargo and adds the CI gates:

```powershell
powershell -File scripts\build-msvc.ps1 -Test      # cargo test --all-targets
powershell -File scripts\build-msvc.ps1 -Release   # cargo build --release
powershell -File scripts\build-msvc.ps1 -Clippy    # cargo clippy -- -D warnings
powershell -File scripts\build-msvc.ps1 -Fmt       # cargo fmt --check
```

Plain `cargo` and `npx tauri` need those variables in your own shell; without them
rustup reports *"no default toolchain"* because the toolchain lives in
`D:\dev\rustup`, not in `%USERPROFILE%\.rustup`. The scripts are the supported path.

## Project structure

```
whatsapp-lite/            # the Tauri app
  src-tauri/src/main.rs   # window, menus, downloads, deep links, tray
  src-tauri/Cargo.toml    # deps + the tuned [profile.release]
  scripts/msvc-env.mjs    # resolves the portable toolchain (single source)
  scripts/tauri.mjs       # npm run dev|build -> @tauri-apps/cli with that env
  scripts/build-msvc.ps1  # portable MSVC cargo (RC / LIB / INCLUDE) + CI gates
perf/                     # measurement harness, raw evidence, verification
BENCHMARKS.md             # what changed and what it cost
OPTIMIZATION_REPORT.md    # full audit: phases, KPIs, rejected variants
BUGS_FOUND.md             # pre-existing bugs, documented not fixed
```

## FAQ

**Is this safe? Do you see my messages?**

No. The window loads `https://web.whatsapp.com` in the WebView2 that Windows already has, exactly like Edge would. There
is no proxy, no interceptor and no local copy of your chats. The app cannot read them any more than your browser can.

**Why not just use the official app?**

The official desktop app is an Electron build: about 200 MB on disk and a bundled Chromium. If you want a native window
and none of that, this exists. If you want WhatsApp's own feature set, use theirs - this will never implement anything
the web client does not do.

**Then why is the RAM 845 MiB?**

Because a WebView is a browser engine: 96 % of that is the WebView2 process tree, and any wrapper of a web app pays it.
The native process is 32 MiB. This project buys disk and startup time, not memory, and pretending otherwise would be
the easiest thing to catch in a benchmark.

**Does it work on Linux?**

The source builds on Linux (WebKitGTK), but no Linux binaries are published yet - see issue #1. The installer in
Releases is Windows only.

**Is it a fork?**

It started from [Wpnnt/WhatsApp-Tauri](https://github.com/Wpnnt/WhatsApp-Tauri) and carries that author's client. What
is new here is the release-profile work, the measurement harness and the audit. The credit line stays no matter how
many stars this gets.

**Can I trust the installer?**

Verify the SHA-256 above, or build it yourself from source - the build is four commands and needs no signing key.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the gates, the size budget (7 MB, CI-enforced) and the two things that will be
declined. Security issues go through [SECURITY.md](SECURITY.md), not a public issue.

## Credits and licence

MIT. Based on [Wpnnt/WhatsApp-Tauri](https://github.com/Wpnnt/WhatsApp-Tauri) - all credit for the original client goes
to its author. This repository adds the release-profile work, the measurement harness, hardening fixes from a source
audit, and a CI guard that fails any PR pushing the binary past 7 MB.

Not affiliated with WhatsApp or Meta. Unofficial client, use at your own risk.

---

If this saves you 200 MB of disk, a star costs nothing and helps other people find it.
