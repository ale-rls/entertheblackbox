@echo off
REM Launch the tracking service on Windows. TouchDesigner owns the physical
REM camera and publishes a Video Stream Out TOP at the local RTSP URL below.
REM Extra args are passed through, e.g. --config C:\show\venue-config.json.
setlocal
set "HERE=%~dp0"
set "VENV=%HERE%..\.venv\Scripts"

if not exist "%VENV%\audience-tracker.exe" (
  echo Could not find the virtual environment.
  echo Run scripts\install_windows.bat first.
  pause
  exit /b 1
)

if not defined TOUCHDESIGNER_RTSP set "TOUCHDESIGNER_RTSP=rtsp://127.0.0.1:8554/audience"

REM Defaults: real backend, GPU, TouchDesigner RTSP, ReID on. TouchDesigner's
REM Video Stream Out TOP must be Active before this command starts.
"%VENV%\audience-tracker.exe" serve --backend real --device cuda --source "%TOUCHDESIGNER_RTSP%" --port 8000 %*
if errorlevel 1 (
  echo.
  echo The tracker exited with an error. Run "%VENV%\audience-tracker.exe" doctor
  echo to check this machine. If ReID/torchreid is not installed here, retry with:
  echo    run_windows.bat --no-reid
  pause
)
