@echo off
REM TSU Graphic Generator - double-click runner (Windows)
REM Generates this client's graphics via OpenAI gpt-image-1.
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH. Install Python 3 from https://www.python.org/downloads/
  echo then re-run this file.
  pause
  exit /b 1
)

if "%OPENAI_API_KEY%"=="" (
  echo OPENAI_API_KEY is not set for this session.
  set /p OPENAI_API_KEY=Paste your OpenAI API key (starts with sk-):
)
if "%OPENAI_API_KEY%"=="" (
  echo No key provided. Tip: set it permanently with:  setx OPENAI_API_KEY "sk-..."
  pause
  exit /b 1
)

echo.
python generate_graphics.py %*
echo.
echo ---- finished ----
pause
endlocal
