# Ronda de depuración — 2026-10-26

Segunda pasada sobre `whatsapp-lite`. La primera ([`DEBUG-TAURI-2026-10-25.md`](DEBUG-TAURI-2026-10-25.md))
arregló el cierre y las aperturas espontáneas. Esta ataca lo que quedaba: el entorno
de compilación, el flujo `npm run dev`, tres defectos de código y una superficie de
permisos que no hacía falta.

Todo lo que sigue está medido en esta máquina, no inferido.

## 1. Causa raíz del "tauri me da problemas": el toolchain no estaba en el PATH

```
$ rustc -V
error: rustup could not choose a version of rustc to run, because one wasn't
specified explicitly, and no default is configured.

$ npm run dev
failed to run 'cargo metadata' command to get workspace directory:
error: rustup could not choose a version of cargo to run, ...
```

Los binarios sí estaban (`D:\dev\cargo\bin\cargo.exe`), pero `RUSTUP_HOME` y
`CARGO_HOME` no existían como variable de usuario ni de máquina. rustup caía en
`%USERPROFILE%\.rustup`, que está vacío, y ahí no hay toolchain. El proyecto sólo
compilaba por `scripts/build-msvc.ps1`, que fija las rutas a mano; cualquier
`cargo`, `cargo tauri` o `npm run dev` moría antes de compilar.

Arreglo:
- `RUSTUP_HOME=D:\dev\rustup` y `CARGO_HOME=D:\dev\cargo` persistidos en el
  entorno del usuario.
- `scripts/msvc-env.mjs`: resuelve la versión más nueva de MSVC y del SDK, y arma
  `RC`, `LIB`, `INCLUDE` y `PATH`.
- `scripts/tauri.mjs`: lanza `@tauri-apps/cli` con ese entorno. `npm run dev` y
  `npm run build` pasan por ahí.

Comprobado: `rustc 1.99.1`, `cargo 1.99.1`, `tauri info` detecta
`stable-x86_64-pc-windows-msvc (default)`.

## 2. `tauri dev` "no hacía nada": single-instance se quedaba el arranque

Con la app instalada abierta (`D:\Whatsapp Tauri\whatsapp-tauri.exe`), `tauri dev`
compila, lanza el binario de `target\debug` y ese binario **muere en el acto**:
el plugin single-instance lo detecta como segunda instancia y redirige el `argv` a
la app instalada, que sólo hace `show()` + `set_focus()`. No aparece ninguna
ventana nueva y parece que Tauri no arrancó.

Evidencia (`%APPDATA%\com.wpnnt.whatsapptauri\events.log`):

```
1793016721 single-instance: argv=["target\\debug\\whatsapp-tauri.exe"]
```

Arreglo: `scripts/tauri.mjs dev` lista los `whatsapp-tauri.exe` vivos con WMI y
**se detiene antes de compilar** (exit 3) explicando las dos salidas: cerrar la
instancia o `npm run dev -- --dev-isolated`, que añade
`--config {"identifier":"com.wpnnt.whatsapptauri.dev"}` para usar perfil de WebView2
aparte. Verificado: con `--dev-isolated` arrancó la ventana de desarrollo
(PID 27388, título "Whatsapp Tauri") mientras la instalada seguía viva.

## 3. Defectos corregidos

| # | Dónde | Qué pasaba | Arreglo |
|---|---|---|---|
| 1 | `src-tauri/src/main.rs:35` (`WEBVIEW_ARGS`) | wry usa `additional_browser_args` **en lugar de** sus defaults (`wry-0.54.4/src/webview2/mod.rs:294`). Al pasar sólo `CalculateNativeWinOcclusion`, se reactivaban la barra OOUI, el visor PDF de Edge y SmartScreen dentro del WebView. | Lista completa: `CalculateNativeWinOcclusion,msWebOOUI,msPdfOOUI,msSmartScreenProtection`. Test `webview_args_keep_the_wry_defaults`. |
| 2 | `main.rs` (arranque con deep link) | `std::thread::sleep(1500ms)` dentro de `async_runtime::spawn`: bloqueaba un worker de tokio 1,5 s en el arranque (B-01 de `BUGS_FOUND.md`). | `spawn_blocking`. |
| 3 | `main.rs` (`on_menu_event`, carpeta de descargas) | El menú nativo se reconstruía dos veces: una en el callback del picker y otra en el bloque común del handler (B-02). Cada reconstrucción lee 5 archivos en el hilo de UI. | Bandera `rebuild_menu`; una sola reconstrucción. |
| 4 | `src-tauri/capabilities/default.json` | La capability se aplica a `https://web.whatsapp.com` y concedía `opener`, `dialog`, `notification`, `autostart` y `global-shortcut` por IPC. Los cinco se usan **sólo desde Rust**, que no pasa por la ACL. | `permissions: ["core:default"]`. Test `remote_capability_grants_no_plugin_permissions` falla si vuelve un permiso de plugin. |
| 5 | `src-tauri/src/window.rs` | Comentario afirmaba que la X oculta a la bandeja; el default es `app.exit(0)`. | Comentario corregido. |
| 6 | `scripts/build-msvc.ps1` | No exponía los gates que el workflow de release exige. | `-Clippy` (`-D warnings`) y `-Fmt` (`--check`). |

## 4. Estado verificado

| Comprobación | Comando | Resultado |
|---|---|---|
| Formato | `cargo fmt --check` | exit 0 |
| Lint | `build-msvc.ps1 -Clippy` | exit 0 con `-D warnings` |
| Tests Rust | `build-msvc.ps1 -Test` | **17 passed, 0 failed** |
| Tests JS | `npm run test:js` | **7 passed, 0 failed** |
| Arranque dev | `npm run dev -- --dev-isolated` | ventana creada, WebView2 hijo vivo |
| Cierre real | `WM_CLOSE` sobre la ventana | proceso terminado, 0 `msedgewebview2` huérfanos |
| Log de cierre | `%APPDATA%\com.wpnnt.whatsapptauri.dev\events.log` | `1793016810 close: exit` |
| Build | `npm run tauri -- build --debug --no-bundle` | exit 0, "Built application at ...\target\debug\whatsapp-tauri.exe" |

## 5. Hallazgos abiertos (no tocados, con motivo)

- **Dependencias desactualizadas**: `tauri` 2.10.3 (última 2.12.5), `wry` 0.54.4,
  `tauri-plugin-notification` 2.3.3 (2.7.0). Actualizar arrastra cambios de API y
  de ACL; no se hace en una ronda de depuración. `tauri info` lo lista.
- **`frontendDist: "icons"`**: el "frontend" empaquetado son los iconos. Funciona
  porque la ventana carga una URL remota, pero es un hack: un `dist/index.html`
  mínimo sería honesto. Sin impacto en runtime.
- **`csp: null`**: con la capability ya reducida a `core:default` la superficie es
  pequeña, pero una CSP sigue siendo la defensa correcta para contenido remoto.
  Requiere probar qué necesita WhatsApp Web (blob:, workers, wasm).
- **`w.open_devtools()` en debug**: abre DevTools en cada `tauri dev`. Útil, ruidoso.
- **`%LOCALAPPDATA%\TauriDeluxe\launch.ps1`**: parche externo que renombra la
  ventana a "Tauri Deluxe" y fuerza primer plano. Con los fixes de 0.3.4 ya no hace
  falta; `cerrar.ps1` sigue sirviendo como "matar de emergencia".

## 6. Reproducir

```powershell
cd D:\dev\whatsapp-tauri\whatsapp-lite
npm run test:js
powershell -File scripts\build-msvc.ps1 -Fmt
powershell -File scripts\build-msvc.ps1 -Clippy
powershell -File scripts\build-msvc.ps1 -Test
npm run dev            # se detiene con aviso si la app instalada está abierta
npm run dev -- --dev-isolated
```
