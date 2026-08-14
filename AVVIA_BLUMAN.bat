@echo off
title Avvio Piattaforma BluMan Advisory
echo ===================================================
echo   🚀 AVVIO BLUMAN ADVISORY PLATFORM
echo ===================================================
echo.
echo 1. Avvio Server Backend Fastify...
start "BluMan Backend" cmd /k "set PATH=C:\Program Files\nodejs;%%PATH%% && npx tsx src/index.ts"

echo 2. Avvio Frontend React...
start "BluMan Frontend" cmd /k "set PATH=C:\Program Files\nodejs;%%PATH%% && cd frontend && npm run dev"

echo.
echo 3. Apertura Browser in corso...
timeout /t 3 >nul
start http://localhost:5173/

echo ===================================================
echo Piattaforma avviata! Puoi chiudere questa finestra.
echo ===================================================
