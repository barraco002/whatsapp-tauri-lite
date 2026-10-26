# Debugging Tauri — Whatsapp Tauri 0.3.4

Fecha: 2026-10-25. Proyecto: `D:\dev\whatsapp-tauri\whatsapp-lite`.
Binario afectado: `D:\Whatsapp Tauri\whatsapp-tauri.exe` (6,0 MB, v0.3.4).

## Sintomas reportados

- "No cierra": la X no termina el proceso.
- "Se abre solo": la ventana aparece sin pedirla.

Los dos son reales y tienen causas distintas. No era un crash: no habia ni un evento de
`Application Error` de la app en 72 h, ni un dump en `CrashDumps`.

## Causa 1 — la X nunca cierra (por diseno)

`src-tauri/src/main.rs:597` interceptaba `CloseRequested`:

```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let _ = window.hide();
        api.prevent_close();   // <- el proceso sigue vivo para siempre
    }
})
```

La unica salida real era el menu de la bandeja: `tray.rs:26` `"quit" => app.exit(0)`.
Sin bandeja visible (iconos ocultos) o sin saber que existia, la app queda zombie: proceso
vivo, `msedgewebview2` hijos vivos, cero ventanas. Eso explica tambien el "no pasa nada"
al hacer doble clic en el acceso directo si el lanzador solo comprobaba "hay proceso?".

## Causa 2 — tres vias de apertura espontanea, todas activas

1. **Protocolo `whatsapp://` registrado en el sistema.**
   `HKCU\Software\Classes\whatsapp\shell\open\command` =
   `"D:\Whatsapp Tauri\whatsapp-tauri.exe" "%1"`.
   Cualquier enlace de WhatsApp (web, correo, otra app) lanza el exe. Ademas
   `read_deep_link_enabled` devuelve `true` cuando el flag no existe, y el directorio
   `%APPDATA%\com.wpnnt.whatsapptauri` no existia: deep-link habilitado por defecto.
2. **Atajo global `Ctrl+Alt+W` registrado incondicionalmente** en `setup`, con handler que
   alterna `show`/`hide`. Cualquier roce del teclado en cualquier aplicacion abre la ventana.
   Es la via mas silenciosa: no deja rastro en ningun log.
3. **Plugin single-instance**: cualquier segundo lanzamiento (acceso directo, `abrir-sin-parpadeo.cmd`,
   `launch.ps1`) no crea instancia nueva, hace `show()` + `set_focus()` sobre la que ya estaba
   escondida en la bandeja. Parece "se abrio sola" cuando en realidad nunca se cerro.

Bug menor asociado: en el handler de single-instance el bucle de `argv` estaba dentro de
`if let Some(w)`, asi que sin ventana no se procesaban los enlaces entrantes.

## Parches aplicados

`src-tauri/src/main.rs`
- Flags persistentes en `app_data_dir`: `close_to_tray.enabled`, `global_shortcut.enabled`.
- `log_event()`: append a `events.log` (epoch + origen). Registra `close`, `shortcut`,
  `single-instance`, `tray`, `window`, `menu`.
- Cierre: **por defecto la X sale de verdad** (`app.exit(0)`). Con "Close to Tray" activado,
  oculta a la bandeja y lo deja escrito en el log.
- `Ctrl+Alt+W`: **desactivado por defecto**; se registra solo si el flag esta on, y el toggle
  del menu lo registra/desregistra en caliente.
- Menu Settings: "Close to Tray (X hides, app keeps running)" y "Ctrl+Alt+W toggles window".
- single-instance: loguea `argv` y procesa enlaces fuera del `if`.

`src-tauri/src/tray.rs` y `window.rs`: log del origen en Open, Quit, click y `show()`.

## Verificacion

```powershell
# compilar
pwsh -File scripts\build-msvc.ps1 -Check     # 2 s en caliente
pwsh -File scripts\build-msvc.ps1 -Release   # lto=fat, tarda

# tras reemplazar el exe: la X debe matar el proceso
Start-Process 'D:\Whatsapp Tauri\whatsapp-tauri.exe'
Start-Sleep 12
(Get-Process whatsapp-tauri).MainWindowHandle   # luego cerrar con la X
Get-Process whatsapp-tauri                      # debe fallar: no queda proceso

# quien abrio la ventana
Get-Content "$env:LOCALAPPDATA\com.wpnnt.whatsapptauri\events.log" -Tail 20
```

Criterio de exito: tras pulsar la X no queda ningun `whatsapp-tauri.exe` ni `msedgewebview2`
huerfano; `events.log` muestra `close: exit`; `Ctrl+Alt+W` no hace nada con el flag off.

## Resultados medidos (2026-10-25 23:56)

- Release compilado: `cargo build --release` en 3m29s, exit 0. `cargo check --all-targets` en 2s, exit 0.
- Binario instalado en `D:\Whatsapp Tauri\whatsapp-tauri.exe`; respaldo previo `.bak-0.3.4-prefix`.
- Prueba 1 (WM_CLOSE sobre la ventana real): **proceso terminado en 0,2 s**, 0 `msedgewebview2` huerfanos.
- Prueba 2 (repeticion con la app recien arrancada): proceso terminado, sin residuos.
- `events.log`: `1792990570 close: exit` / `1792990603 close: exit`.
- `Ctrl+Alt+W`: libre con la app cerrada **y** con la app abierta (registro externo concedido) → la app ya no lo secuestra.

## Rollback

`D:\Whatsapp Tauri\whatsapp-tauri.exe.bak-0.3.3` (version previa) y el binario 0.3.4 actual
respaldado antes de reemplazar. Los flags son archivos: borrar
`%LOCALAPPDATA%\com.wpnnt.whatsapptauri\*.enabled` vuelve a los defaults del codigo.

## Nota sobre los scripts de TauriDeluxe

`%LOCALAPPDATA%\TauriDeluxe\{launch,cerrar,test-ciclo}.ps1` son parches externos que rodean
el comportamiento viejo (renombrar la ventana, matar el proceso a mano, limpiar webviews).
Con el arreglo dejan de ser necesarios; `cerrar.ps1` sigue siendo util como "matar de emergencia".
