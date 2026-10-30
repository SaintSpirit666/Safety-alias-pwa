@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "PYTHON_CMD="

where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py"

if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo Python was not found.
  echo Install Python 3 and run this file again.
  pause
  exit /b 1
)

netstat -ano -p tcp | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Port %PORT% is already in use.
  echo Close the application using this port and try again.
  pause
  exit /b 1
)

echo Starting Safety ALIAS at http://127.0.0.1:%PORT%/
start "Safety ALIAS Server" /min cmd /k "%PYTHON_CMD% -m http.server %PORT% --bind 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"

echo Application opened in the browser.
echo To stop the server, close the minimized "Safety ALIAS Server" window.
timeout /t 4 /nobreak >nul
endlocal
