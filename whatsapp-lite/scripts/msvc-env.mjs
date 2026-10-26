// Resuelve el entorno de compilacion portable de este proyecto.
//
// Rust vive en D:\dev\rustup + D:\dev\cargo y MSVC/SDK en D:\dev\BuildTools:
// no hay Visual Studio instalado ni variables globales que lo delaten. Sin esto,
// `cargo` arranca rustup contra %USERPROFILE%\.rustup (vacio) y muere con
// "no default toolchain", y tauri-build panicka buscando RC.EXE.
//
// Fuente unica para scripts/tauri.mjs; scripts/build-msvc.ps1 mantiene su propia
// copia porque debe funcionar aunque Node no este disponible.
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";

const envOr = (key, fallback) => process.env[key] || fallback;

export const RUSTUP_HOME = envOr("RUSTUP_HOME", "D:\\dev\\rustup");
export const CARGO_HOME = envOr("CARGO_HOME", "D:\\dev\\cargo");
export const BUILDTOOLS = envOr("MSVC_BUILDTOOLS", "D:\\dev\\BuildTools");

const byVersionDesc = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** Devuelve la subcarpeta con la version mas alta (14.44.35207, 10.0.26100.0...). */
export function newestVersionedDir(parent) {
  if (!existsSync(parent)) {
    throw new Error(`No existe ${parent}. Define MSVC_BUILDTOOLS o instala el toolchain portable.`);
  }
  const candidates = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\./.test(entry.name))
    .map((entry) => entry.name)
    .sort(byVersionDesc);
  if (candidates.length === 0) {
    throw new Error(`${parent} no contiene ninguna carpeta versionada.`);
  }
  return join(parent, candidates[0]);
}

export function resolveToolchain() {
  const msvcRoot = newestVersionedDir(join(BUILDTOOLS, "VC", "Tools", "MSVC"));
  const sdkBin = newestVersionedDir(join(BUILDTOOLS, "Windows Kits", "10", "bin"));
  const sdkLib = newestVersionedDir(join(BUILDTOOLS, "Windows Kits", "10", "Lib"));
  const sdkInc = newestVersionedDir(join(BUILDTOOLS, "Windows Kits", "10", "Include"));

  const paths = {
    msvcBin: join(msvcRoot, "bin", "Hostx64", "x64"),
    msvcLib: join(msvcRoot, "lib", "x64"),
    msvcInc: join(msvcRoot, "include"),
    rcDir: join(sdkBin, "x64"),
    umLib: join(sdkLib, "um", "x64"),
    ucrtLib: join(sdkLib, "ucrt", "x64"),
    ucrtInc: join(sdkInc, "ucrt"),
    umInc: join(sdkInc, "um"),
    sharedInc: join(sdkInc, "shared"),
    winrtInc: join(sdkInc, "winrt"),
  };

  const required = [
    join(paths.rcDir, "rc.exe"),
    join(paths.msvcBin, "link.exe"),
    join(paths.umLib, "kernel32.lib"),
    join(paths.ucrtLib, "libucrt.lib"),
    join(paths.umInc, "windows.h"),
    join(CARGO_HOME, "bin", "cargo.exe"),
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`Toolchain incompleto, falta:\n  ${missing.join("\n  ")}`);
  }

  return { ...paths, msvcRoot, sdkBin };
}

/** Entorno completo para cargo/tauri: rustup, MSVC, LIB/INCLUDE y PATH. */
export function buildEnv(overrides = {}) {
  const tc = resolveToolchain();
  return {
    ...process.env,
    RUSTUP_HOME,
    CARGO_HOME,
    RC: join(tc.rcDir, "rc.exe"),
    LIB: [tc.msvcLib, tc.ucrtLib, tc.umLib].join(";"),
    INCLUDE: [tc.msvcInc, tc.ucrtInc, tc.umInc, tc.sharedInc, tc.winrtInc].join(";"),
    PATH: [tc.rcDir, tc.msvcBin, join(CARGO_HOME, "bin"), process.env.PATH || ""].join(delimiter),
    ...overrides,
  };
}

export function describeToolchain() {
  const tc = resolveToolchain();
  return `MSVC ${tc.msvcRoot} / SDK ${tc.sdkBin}`;
}
