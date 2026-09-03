@echo off
REM  NoteWell — double-click to run. Nothing is uploaded anywhere.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8787
echo.
echo   Starting NoteWell...
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%
  node server\server.js
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  echo   ^(Node isn't installed — using Python. Accounts/sync need Node,^)
  echo   ^(everything else works.^)
  echo.
  echo   Open  http://localhost:%PORT%
  start "" http://localhost:%PORT%
  python -m http.server %PORT% --bind 0.0.0.0
  goto :eof
)
echo   Please install Node ^(nodejs.org^) or Python 3, then run this again.
pause
