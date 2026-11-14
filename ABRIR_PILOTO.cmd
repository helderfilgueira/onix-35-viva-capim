@echo off
cd /d "%~dp0"
py -3 deploy\launch_local.py
if errorlevel 1 pause
