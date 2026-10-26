@echo off
rem Gate local: mismo comando que usa `am close --check`.
rem Sin esto, el check tiene que citar una ruta con espacios y se rompe al anidar comillas.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-msvc.ps1" -Test
