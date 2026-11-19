@echo off

REM Relaunch this script inside a "cmd /k" shell if it isn't already running
REM in one. cmd /k keeps the console window open no matter what happens next
REM (even an unexpected crash mid-script) -- this is what actually prevents
REM "the window flashed and closed before I could read anything", regardless
REM of what specifically goes wrong below.
REM
REM The dropped file's path is carried across the relaunch via an env var
REM (RRV_ARG1), NOT as a literal argument on the "cmd /k ..." line. cmd.exe
REM has a well-known quote-mangling bug when a quoted path that contains a
REM space (this repo's own folder does: "niitlahti.fi boardgame") is
REM followed by more text like %* on the same /k command line -- it strips
REM the wrong quotes and splits the path apart. Passing nothing but the
REM script's own quoted path to /k sidesteps that bug entirely.
if not defined RRV_KEEPALIVE (
    set "RRV_KEEPALIVE=1"
    set "RRV_ARG1=%~1"
    cmd /k "%~f0"
    exit /b
)

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================================
echo   Niitlahti Boardgame - Replay Video Renderer
echo ===============================================
echo.
echo [1/6] Script started. Working directory:
echo   %cd%
echo.

set "BUNDLE=%RRV_ARG1%"
if "%BUNDLE%"=="" (
    echo [2/6] No file was dropped on this script.
    set /p BUNDLE=Type or paste the full path to the tournament-video-*.json file, then press Enter:
) else (
    echo [2/6] Received a dropped file.
)

if "%BUNDLE%"=="" (
    echo No file given. Exiting.
    goto :end
)

set BUNDLE=%BUNDLE:"=%
echo   Bundle file: %BUNDLE%

if not exist "%BUNDLE%" (
    echo ERROR: Could not find file: %BUNDLE%
    goto :end
)
echo   File found on disk.
echo.

echo [3/6] Checking for Python on PATH...
where python
if errorlevel 1 (
    echo ERROR: Python was not found on PATH. Install Python 3.9+ from https://www.python.org/downloads/ and try again.
    goto :end
)
python --version
echo.

echo [4/6] Checking for ffmpeg on PATH...
where ffmpeg
if errorlevel 1 (
    echo ERROR: ffmpeg was not found on PATH. Install it ^(winget install ffmpeg^) and try again.
    goto :end
)
echo.

echo [5/6] Installing/checking Python dependencies (Pillow)...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies. See the pip output above.
    goto :end
)
echo.

for %%F in ("%BUNDLE%") do set "OUTDIR=%%~dpF"
for %%F in ("%BUNDLE%") do set "OUTNAME=%%~nF"
set "OUTPUT=%OUTDIR%%OUTNAME%.mp4"

echo [6/6] Rendering...
echo   Input:  %BUNDLE%
echo   Output: %OUTPUT%
echo   (this can take a minute or two for a full tournament)
echo.

python render_replay.py "%BUNDLE%" "%OUTPUT%"
if errorlevel 1 (
    echo.
    echo ERROR: Rendering failed - see the error above ^(exit code %errorlevel%^).
    goto :end
)

echo.
echo Done! Video saved to:
echo   %OUTPUT%

:end
echo.
echo ================================================
echo  Finished. This window stays open on purpose --
echo  press any key or close it manually when you're
echo  done reading the output above.
echo ================================================
pause >nul
