# Compila whatsapp-tauri con el toolchain MSVC portatil (sin Visual Studio instalado).
#
# El SDK y MSVC viven en D:\dev\BuildTools. link.exe se define en .cargo\config.toml,
# pero rc.exe (recursos del .exe, lo usa tauri-winres) y las rutas LIB/INCLUDE no:
# hay que exponerlas en el entorno o el build script panicka preguntando por RC.EXE.
#
# Uso:
#   powershell -File scripts\build-msvc.ps1 -Test      # cargo test --all-targets
#   powershell -File scripts\build-msvc.ps1 -Release   # cargo build --release
#   powershell -File scripts\build-msvc.ps1 -Check     # cargo check --all-targets
#   powershell -File scripts\build-msvc.ps1 -Clippy    # clippy con -D warnings (gate de CI)
#   powershell -File scripts\build-msvc.ps1 -Fmt       # cargo fmt --check (gate de CI)
param(
    [switch]$Test,
    [switch]$Release,
    [switch]$Check,
    [switch]$Clippy,
    [switch]$Fmt
)

$ErrorActionPreference = 'Stop'

$buildTools = if ($env:MSVC_BUILDTOOLS) { $env:MSVC_BUILDTOOLS } else { 'D:\dev\BuildTools' }
$cargoHome  = if ($env:CARGO_HOME)     { $env:CARGO_HOME }     else { 'D:\dev\cargo' }
$rustupHome = if ($env:RUSTUP_HOME)    { $env:RUSTUP_HOME }    else { 'D:\dev\rustup' }

function Get-NewestDirectory([string]$path) {
    if (-not (Test-Path $path)) { throw "No existe: $path" }
    Get-ChildItem $path -Directory |
        Where-Object { $_.Name -match '^\d+\.' } |
        Sort-Object { [version]($_.Name) } -Descending |
        Select-Object -First 1
}

$msvcRoot = Get-NewestDirectory (Join-Path $buildTools 'VC\Tools\MSVC')
$sdkBin   = Get-NewestDirectory (Join-Path $buildTools 'Windows Kits\10\bin')
$sdkLib   = Get-NewestDirectory (Join-Path $buildTools 'Windows Kits\10\Lib')
$sdkInc   = Get-NewestDirectory (Join-Path $buildTools 'Windows Kits\10\Include')

$msvcBin   = Join-Path $msvcRoot.FullName 'bin\Hostx64\x64'
$msvcLib   = Join-Path $msvcRoot.FullName 'lib\x64'
$msvcInc   = Join-Path $msvcRoot.FullName 'include'
$rcDir     = Join-Path $sdkBin.FullName 'x64'
$umLib     = Join-Path $sdkLib.FullName 'um\x64'
$ucrtLib   = Join-Path $sdkLib.FullName 'ucrt\x64'
$ucrtInc   = Join-Path $sdkInc.FullName 'ucrt'
$umInc     = Join-Path $sdkInc.FullName 'um'
$sharedInc = Join-Path $sdkInc.FullName 'shared'
$winrtInc  = Join-Path $sdkInc.FullName 'winrt'

foreach ($required in @(
    (Join-Path $rcDir 'rc.exe'),
    (Join-Path $msvcBin 'link.exe'),
    (Join-Path $umLib 'kernel32.lib'),
    (Join-Path $ucrtLib 'libucrt.lib'),
    (Join-Path $umInc 'windows.h')
)) {
    if (-not (Test-Path $required)) { throw "Toolchain incompleto, falta: $required" }
}

$env:RUSTUP_HOME = $rustupHome
$env:CARGO_HOME  = $cargoHome
$env:RC          = Join-Path $rcDir 'rc.exe'
$env:PATH        = ((@($rcDir, $msvcBin, (Join-Path $cargoHome 'bin')) -join ';') + ';' + $env:PATH)
$env:LIB         = @($msvcLib, $ucrtLib, $umLib) -join ';'
$env:INCLUDE     = @($msvcInc, $ucrtInc, $umInc, $sharedInc, $winrtInc) -join ';'

$cargo = Join-Path $cargoHome 'bin\cargo.exe'
if (-not (Test-Path $cargo)) { throw "No existe cargo en $cargo" }

$srcTauri = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri'
$manifest = Join-Path $srcTauri 'Cargo.toml'
if ($Test)        { $cargoArgs = @('test', '--all-targets', '--manifest-path', $manifest) }
elseif ($Release) { $cargoArgs = @('build', '--release', '--manifest-path', $manifest) }
elseif ($Check)   { $cargoArgs = @('check', '--all-targets', '--manifest-path', $manifest) }
elseif ($Clippy)  { $cargoArgs = @('clippy', '--all-targets', '--manifest-path', $manifest, '--', '-D', 'warnings') }
elseif ($Fmt)     { $cargoArgs = @('fmt', '--manifest-path', $manifest, '--check') }
else { throw 'Indica -Test, -Release, -Check, -Clippy o -Fmt' }

$target = Join-Path $srcTauri 'target'
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
$outLog = Join-Path $target 'cargo-out.log'
$errLog = Join-Path $target 'cargo-err.log'

Write-Host "Toolchain MSVC $($msvcRoot.Name) / SDK $($sdkBin.Name)"
Write-Host "rc.exe   -> $env:RC"
Write-Host "link.exe -> $(Join-Path $msvcBin 'link.exe')"
Write-Host "cargo $($cargoArgs -join ' ')"

# Start-Process evita que el stderr de cargo se convierta en NativeCommandError
# (con $ErrorActionPreference = 'Stop' abortaria la compilacion en el primer aviso).
$proc = Start-Process -FilePath $cargo -ArgumentList $cargoArgs -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Get-Content $outLog -Tail 150 -ErrorAction SilentlyContinue
Get-Content $errLog -Tail 80 -ErrorAction SilentlyContinue
Write-Host "exit $($proc.ExitCode)"
exit $proc.ExitCode
