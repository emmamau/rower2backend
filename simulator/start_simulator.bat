@echo off
chcp 65001 >nul
title Simulateur de Charge Garmin FTMS (30 Montres)

echo ========================================================
echo   Lancement du Simulateur de Charge Garmin FTMS
echo ========================================================
echo.

cd /d "%~dp0"

set "PYTHON_EXE=python"
if exist "C:\Users\Emma\AppData\Local\Python\bin\python.exe" (
    set "PYTHON_EXE=C:\Users\Emma\AppData\Local\Python\bin\python.exe"
)

echo [1/3] Vérification de Python...
"%PYTHON_EXE%" --version
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Python introuvable. Veuillez installer Python 3.10+ ou vérifier votre PATH.
    pause
    exit /b 1
)

echo.
echo [2/3] Vérification des dépendances...
"%PYTHON_EXE%" -m pip install -q -r requirements.txt

echo.
echo [3/3] Démarrage du serveur Web et de l'Agent de simulation...
echo.
echo Dashboard disponible sur : http://localhost:8080
echo.

start "" "http://localhost:8080"
"%PYTHON_EXE%" main.py

pause
