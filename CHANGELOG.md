# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Development environment on this machine**: `npm run dev` and `npm run build` died before compiling with *"rustup could not choose a version of rustc"*, because the toolchain lives in `D:\dev\rustup` while `RUSTUP_HOME`/`CARGO_HOME` were unset. `scripts/msvc-env.mjs` resolves the portable toolchain and `scripts/tauri.mjs` launches the CLI with `RUSTUP_HOME`, `CARGO_HOME`, `RC`, `LIB`, `INCLUDE` and `PATH` already set. `npm run dev` no longer needs a hand-configured shell.
- **Lost Chromium defaults in the WebView**: `additional_browser_args` replaces wry's defaults instead of adding to them (`wry-0.54.4/src/webview2/mod.rs:294`), so passing only `CalculateNativeWinOcclusion` re-enabled the OOUI bar, Edge's PDF viewer and SmartScreen inside the app. The full `--disable-features=` list is now explicit.
- **Slow async worker on deep-link startup (B-01)**: the 1.5 s delay ran `std::thread::sleep` inside `async_runtime::spawn`, blocking a tokio worker; it now uses `spawn_blocking`.
- **Double menu rebuild (B-02)**: selecting a custom download folder rebuilt the native menu twice (once in the dialog callback, once in the shared tail of the handler); the shared tail now runs once.
- **Stale comment in `window::show`**: it still claimed the X always hides to the tray; the default is `app.exit(0)`.

### Changed
- **Remote capability reduced to `core:default`**: the window's capability applies to `https://web.whatsapp.com`, so `opener`, `dialog`, `notification`, `autostart` and `global-shortcut` IPC permissions were reachable from page JavaScript. Every plugin is driven from Rust, which does not go through the ACL. A contract test fails if a plugin permission returns to that file.
- **CI gates reachable locally**: `scripts/build-msvc.ps1` gained `-Clippy` and `-Fmt`, the two checks the release workflow enforces.
- `scripts/tauri.mjs dev` refuses to start when another `whatsapp-tauri.exe` is running (single-instance would silently steal the launch) and offers `--dev-isolated` with a separate identifier/profile.

## [0.3.4] - 2026-10-24

### Fixed
- **Notification Flood and Screen Flicker**: WhatsApp Web inside the WebView emitted one Windows toast per incoming message. A burst (active chat, group, or the history resync after linking a device) queued dozens of toasts and forced a full WebView repaint for each one, so the desktop visibly flickered. A guard injected before the page code now allows **one toast per chat every 5 s**, caps the global budget at **6 toasts per minute**, and collapses the suppressed messages into a single "N mensajes nuevos" notice. If the guard throws, the native `Notification` API is left untouched, so WhatsApp keeps working.
- **Whole-Window Repaint on Show/Hide**: the WebView now receives `--disable-features=CalculateNativeWinOcclusion`, which removes the full repaint (and the associated flicker) when the window is shown, hidden or restored from the tray.

### Added
- `src-tauri/src/notification_guard.js` and `tests/notification-guard.test.mjs`: seven behavior tests covering burst grouping, per-chat isolation, the global per-minute budget, static API delegation (`permission`, `requestPermission`), the fallback when no native `Notification` exists, and the `ServiceWorkerRegistration.showNotification` path — the second route a web page can use to raise a system toast. Run with `npm run test:js`.
- Rust contract tests for the injected guard (limits inside the designed range, service-worker coverage, grouped-copy present), the bootstrap script and the WebView arguments.
- `scripts/build-msvc.ps1`: reproduces the portable MSVC build (sets `RC`, `LIB`, `INCLUDE` and the linker from `D:\dev\BuildTools`) with `-Test`, `-Release` or `-Check`. Without it the Tauri build script aborts with "Are you sure you have RC.EXE in your $PATH" on machines with no Visual Studio installed.

### Changed
- The layout/notification bootstrap is now `BOOTSTRAP_JS` and the Chromium arguments are `WEBVIEW_ARGS`, both next to the guard, so the injection order is explicit: guard first, bootstrap second.

## [0.3.3] - 2026-10-24

### Added
- **Dark Native Chrome on Windows**: The window now declares `theme: "Dark"`, so the native title bar, the menu bar, and dropdown menus render dark and match the WhatsApp dark UI instead of the system light theme. A window `backgroundColor` (`#111b21`) also removes the white flash at startup. Full source audit: see [AUDIT.md](AUDIT.md).

### Fixed
- **Windows Reserved Filenames**: Download filename sanitization now prefixes Windows reserved device names (`CON`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, …) — which resolve to hardware even with an extension — and strips control characters and trailing dots/spaces so the reserved name matches the file actually written.
- **Tray Left Click**: The tray context menu no longer pops up on left click together with the window; the menu is right-click only, matching standard tray behavior.
- **Global Shortcut Diagnostics**: A failure to register the `Ctrl + Alt + W` global shortcut (e.g., taken by another app) is now reported on stderr instead of being silently discarded.

## [0.3.2] - 2026-10-02

### Fixed
- **Navigation Security**: Internal WebView navigation now requires HTTPS and an exact approved WhatsApp hostname; deep links are structurally parsed and validated before navigation.
- **Download Destination Validation**: Invalid custom download folders now cancel the download instead of silently falling back to another destination.
- **Concurrent Downloads**: Active download paths are reserved so simultaneous files with the same suggested name receive distinct destinations.

### Changed
- **Download Save Prompt**: Removed the per-download save dialog because Tauri's synchronous download callback cannot safely wait for its asynchronous result. Downloads continue to support a selected custom folder or the system Downloads directory.
- **Release Quality Gate**: Release artifact publishing now depends on Rust formatting, Clippy, and test checks.

## [0.3.1] - 2026-09-06
### Fixed
- **Cancel Download**: With "Always Ask Where to Save Files" enabled, dismissing/canceling the save dialog now cancels the download entirely instead of silently saving to the default folder.
- **English Notifications**: Download completion notifications now use English copy ("Download Completed" / "... saved to ...").

### Changed
- **CI**: Upgraded `actions/checkout` and `actions/setup-node` to v5, removing Node.js 20 deprecation warnings from release builds.

## [0.3.0] - 2026-09-06
### Added
- **Download Manager**: Choose a custom download folder via `Settings → Select Custom Download Folder...` or let every file be saved through a native dialog with `Always Ask Where to Save Files`. Settings persist across restarts.
- **Safe Filename Handling**: Sanitizes invalid characters and auto-renames duplicates (`name (1).ext`) so downloads never silently overwrite existing files.
- **Download Notifications**: Native system notification ("Download Completed") with file name and destination path when a download finishes.
- **Settings Submenu**: Full native menu with toggles for Start with System (autostart), Handle WhatsApp Links (deep-link on/off, persisted, re-registers/unregisters the `whatsapp://` scheme on the fly) and download options, plus the About dialog under Help.
- **Close-to-Tray**: Closing the window hides the app to the system tray instead of quitting (Quit via tray menu or Ctrl+Alt+W to toggle the window).

### Changed
- **Native Menu Reconstruction**: The menu is fully rebuilt after every menu interaction so checkbox states always stay in sync with real app state (avoids Windows checkmark bugs).

## [0.2.0] - 2026-05-25
### Added
- **Deep Link Support (`whatsapp://`)**: Fully implemented support for opening `whatsapp://send` and `whatsapp://chat` links directly from the OS, enabling seamless joining of groups and starting direct chats from the browser.
- **Robust Link Parsing**: Automatically extracts and converts `chat.whatsapp.com` web links into native internal routes when passed to the app.
- **Triple Redundancy Link Handling**: Ensures 100% reliability on Windows by capturing links via Tauri events, Command-Line Arguments (`argv`), and Cold Start verification.
- **Native External Link Interceptor**: External links (e.g., YouTube, GitHub) clicked inside the chat are now securely intercepted by the Rust backend (`on_navigation` hook) and opened in the system's default browser, preventing the app from navigating away from WhatsApp.

### Changed
- **Pure Rust Architecture**: The app is now 100% native Rust. Removed all dependency on local JavaScript/HTML frontend files.
- **Inline CSS Injection**: The UI-cleaning CSS (removing download banners) is now injected natively by the Rust backend on load, eliminating visual tearing and the need for external scripts.
- **Tray & Window Logic**: Refactored the System Tray and Window event handling for cleaner application shutdown and better performance.

### Removed
- **Frontend Dependencies**: Completely removed heavy, unused JavaScript dependencies (`@tauri-apps/api`, `@tauri-apps/plugin-opener`, `sharp`) and the empty `frontend/` folder, drastically reducing the project footprint.
- **External Scripts**: Removed `inject.js` and custom Node.js icon generation scripts (now using the official Tauri CLI).

## [0.1.1] - 2026-05-02
### Added
- Tray icon tooltip displaying "WhatsApp Tauri".
- Smart versioning script `npm run version`.
- GitHub Actions CI/CD pipeline for Windows and Linux.
- Professional "About" dialog with full metadata and icon.

