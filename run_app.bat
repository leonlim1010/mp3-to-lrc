@echo off
echo Installing/checking requirements...
pip install -r requirements.txt -q
echo.
echo Starting SoniScript...
echo Open http://127.0.0.1:8000 in your browser once you see "Uvicorn running" below.
echo NOTE: The Whisper AI model will download on your FIRST Auto Sync click (not at startup).
echo.
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
