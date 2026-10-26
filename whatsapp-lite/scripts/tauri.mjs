#!/usr/bin/env node
// Lanza la CLI de Tauri con el entorno de compilacion portable ya resuelto.
//
// Uso: node scripts/tauri.mjs dev | build | info | icon ...
// Equivale a `npx tauri <cmd>` pero sin depender del PATH global ni de Visual Studio.
//
// En `dev` hay dos guardas que ahorran el fallo mas confuso de este proyecto:
//   - si la app instalada (D:\Whatsapp Tauri) esta corriendo, el plugin
//     single-instance se queda el arranque y la ventana de desarrollo nunca
//     aparece. Se avisa antes de gastar la compilacion.
//   - `--dev-isolated` cambia el identifier para usar un perfil de WebView2
//     aparte cuando se quiere correr en paralelo a la instalada.
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEnv, describeToolchain } from "./msvc-env.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const rawArgs = process.argv.slice(2);
const isolated = rawArgs.includes("--dev-isolated");
const args = rawArgs.filter((arg) => arg !== "--dev-isolated");

if (args.length === 0) {
  console.error("Uso: node scripts/tauri.mjs <dev|build|info|icon|...> [args]");
  process.exit(2);
}

const isDev = args[0] === "dev";

/** Procesos whatsapp-tauri vivos, con su ruta, via WMI (no depende de wmic). */
function runningInstances() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='whatsapp-tauri.exe'\" | " +
    "Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress";
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

if (isDev && !isolated) {
  const running = runningInstances();
  if (running.length > 0) {
    const list = running
      .map((p) => `  PID ${p.ProcessId}: ${p.ExecutablePath ?? "(ruta desconocida)"}`)
      .join("\n");
    console.error(
      [
        "[tauri] Ya hay una instancia de whatsapp-tauri en ejecucion:",
        list,
        "",
        "El plugin single-instance se quedara el arranque y la ventana de dev no",
        "aparecera (la instancia vieja solo recibe el foco). Opciones:",
        "  1) cierra esa instancia y repite el comando;",
        "  2) npm run dev -- --dev-isolated   (perfil WebView2 aparte, pide QR nuevo).",
      ].join("\n"),
    );
    process.exit(3);
  }
}

if (isDev && isolated && !args.includes("--config")) {
  args.push("--config", JSON.stringify({ identifier: "com.wpnnt.whatsapptauri.dev" }));
  console.error("[tauri] modo aislado: identifier com.wpnnt.whatsapptauri.dev");
}

let env;
try {
  env = buildEnv();
} catch (error) {
  console.error(`[tauri] ${error.message}`);
  process.exit(2);
}

console.error(`[tauri] ${describeToolchain()}`);

const child = spawn(process.execPath, [cliPath, ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[tauri] no se pudo lanzar la CLI: ${error.message}`);
  process.exit(2);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
