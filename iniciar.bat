@echo off
title DuskDex
cd /d "%~dp0"
chcp 65001 >nul

if not exist "backend\bin\setup.php" (
  echo Parece que o zip nao foi extraido.
  echo Clique com o botao direito no duskdex.zip, escolha "Extrair tudo"
  echo e depois rode o iniciar.bat de dentro da pasta extraida.
  pause
  exit /b 1
)

set "PHP="
if exist "C:\xampp\php\php.exe" set "PHP=C:\xampp\php\php.exe"
if not defined PHP (
  where php >nul 2>nul && set "PHP=php"
)
if not defined PHP (
  echo Nao encontrei o PHP. Instale o XAMPP em C:\xampp ou coloque o php no PATH.
  pause
  exit /b 1
)

echo == Preparando o DuskDex ==
"%PHP%" backend\bin\setup.php
if errorlevel 1 ( pause & exit /b 1 )

"%PHP%" backend\bin\migrate.php
if errorlevel 1 ( pause & exit /b 1 )

echo.
echo == Tudo pronto. Abrindo http://127.0.0.1:8080 ==
echo (deixe esta janela aberta enquanto usa o site; feche-a para desligar)
echo.
start "" "http://127.0.0.1:8080"
"%PHP%" -S 127.0.0.1:8080 server.php
pause
