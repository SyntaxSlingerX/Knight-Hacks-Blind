@echo off
set DEVICE_IP=%1
if "%DEVICE_IP%"=="" set DEVICE_IP=10.149.207.241

echo ==========================================================
echo   Starting Meta Project Aria Bridge (Ultra-Smooth Hotspot)
echo   Target Aria Glasses IP: %DEVICE_IP%
echo ==========================================================

python aria_bridge.py --mode aria --interface wifi --device-ip %DEVICE_IP% --hotspot
