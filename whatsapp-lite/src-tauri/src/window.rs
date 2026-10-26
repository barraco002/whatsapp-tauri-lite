use tauri::{AppHandle, Manager, Runtime};

use crate::log_event;

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        // La X sale por defecto (main.rs: CloseRequested -> app.exit) o esconde a la
        // bandeja si "Close to Tray" esta activo; este show() cubre ambos casos y el
        // arranque desde el tray. Si ademas quedo minimizada, show() solo no la trae
        // al frente.
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        log_event(app, "window: show");
    }
}
