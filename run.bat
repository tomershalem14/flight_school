@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  מערכת לוז - בית ספר לטיסה
echo  --------------------------------
echo.

python --version > nul 2>&1
if errorlevel 1 (
    echo Python לא נמצא
    pause
    exit /b
)

python -c "import fastapi, uvicorn" > nul 2>&1
if errorlevel 1 (
    echo מתקין חבילות...
    pip install -r requirements.txt
    echo.
)

echo מפעיל שרת...
echo http://localhost:5050
echo.

start /b cmd /c "timeout /t 2 > nul && start http://localhost:5050"

python -m uvicorn main:app --host 0.0.0.0 --port 5050

echo.
echo השרת נסגר.
pause