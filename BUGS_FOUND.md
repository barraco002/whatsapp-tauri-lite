# BUGS_FOUND.md — defectos preexistentes detectados durante el trabajo de rendimiento

Regla del runbook (§0.4): se registran y **no se arreglan** sin permiso explícito.
Ninguno de estos hallazgos ha sido modificado por las iteraciones de rendimiento.

Actualización 2026-10-26: B-01 y B-02 se corrigieron en la ronda de depuración
(`DEBUG-ROUND-2026-10-26.md`); B-03 sigue abierto y requiere tocar features de `tauri`.

## B-01 — `std::thread::sleep` dentro de `async_runtime::spawn` (bloqueo de worker)

- **Ubicación:** `whatsapp-lite/src-tauri/src/main.rs:513-524`
- **Qué pasa:** al arrancar con un deep link pendiente (`whatsapp://...`), se hace
  `tauri::async_runtime::spawn(async move { std::thread::sleep(1500ms); handle_link(...) })`.
  `thread::sleep` bloquea el hilo del reactor de tokio durante 1.5 s en lugar de cederlo.
- **Impacto:** con 8 cores, un worker de 8 queda inutilizado 1.5 s justo en el arranque; el
  efecto visible es jank en el primer render y cualquier tarea async concurrente se retrasa.
- **Severidad:** media (correctitud del runtime async).
- **Estado: CORREGIDO 2026-10-26** con `tauri::async_runtime::spawn_blocking` (la variante
  `tokio::time::sleep` habría exigido añadir `tokio` con feature `time` al manifiesto).
  Evidencia en `DEBUG-ROUND-2026-10-26.md` §3.

## B-02 — El menú nativo se reconstruye dos veces por evento

- **Ubicación:** `main.rs:556-582` (caso `MENU_DOWNLOAD_FOLDER_PICK_ID` reconstruye en 565-567 y el
  bloque común de 578-582 reconstruye otra vez).
- **Impacto:** el doble trabajo incluye 3 lecturas de disco síncronas por reconstrucción; en el hilo de UI.
- **Severidad:** baja-media (latencia de UI, no corrupción).
- **Estado: CORREGIDO 2026-10-26**: bandera `rebuild_menu`; el callback del picker reconstruye
  y el bloque común ya no lo repite. Evidencia en `DEBUG-ROUND-2026-10-26.md` §3.

## B-03 — `infer` compilado aunque el drag&drop está desactivado

- **Ubicación:** `main.rs:393` `.disable_drag_drop_handler()` frente a `cargo bloat`: `infer` 33.6 KiB.
- **Impacto:** bytes muertos en el binario.
- **Severidad:** cosmética (tamaño).
- **Nota:** entra por features de `tauri`; no se puede quitar sin tocar features (candidato 6, requiere aprobación).

## B-04 — Avalancha de toasts y repintado de pantalla completa (CORREGIDO en 0.3.4)

- **Ubicación:** `src-tauri/src/main.rs` (construcción de `WebviewWindowBuilder`) y ausencia de
  guarda sobre la API de notificaciones de la página.
- **Qué pasaba:** WhatsApp Web emite una notificación del sistema por cada mensaje entrante. En
  una ráfaga (chat activo, grupo, resincronización tras vincular un dispositivo) Windows encadenó
  64 toasts en un día desde `com.wpnnt.whatsapptauri`, todos de la misma conversación, con un pico
  de 5 en un minuto. Cada toast forzaba además un repintado completo del WebView, medido como 4
  cambios de brillo a pantalla completa en 3 s (captura a 4 Hz); con la app cerrada, 10 frames
  consecutivos idénticos.
- **Causa doble:** (1) no había límite de avisos por chat ni global; (2) la característica
  `CalculateNativeWinOcclusion` de Chromium obliga a recomponer toda la superficie cuando la
  ventana se tapa o se restaura.
- **Severidad:** alta (usabilidad; la pantalla parpadea y la barra de tareas se satura).
- **Corrección aplicada (permiso explícito del usuario, 2026-10-24):** guarda inyectada antes del
  código de la página (un aviso por chat cada 5 s, 6 por minuto global, resto agrupado en
  "N mensajes nuevos", con cobertura de `window.Notification` y del service worker) y
  `--disable-features=CalculateNativeWinOcclusion` en los argumentos del WebView. Verificado con
  7 pruebas de comportamiento en `tests/notification-guard.test.mjs` y pruebas de contrato en Rust.
- **Prevención:** las pruebas forman parte de `node --test` y `cargo test --all-targets`; el
  script `scripts/build-msvc.ps1` reproduce el entorno de compilación portátil.
