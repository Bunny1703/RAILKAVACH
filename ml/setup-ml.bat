@echo off
setlocal
cd /d "%~dp0.."
echo Installing RAILKAVACH ML dependencies...
python -m pip install -r ml\requirements.txt
if errorlevel 1 (
  echo.
  echo ML dependency installation failed.
  pause
  exit /b 1
)
echo.
echo Testing ML environment...
python -c "import joblib, sklearn, pandas, numpy, ultralytics; print('ML + YOLO dependencies OK')"
if errorlevel 1 (
  echo.
  echo ML verification failed.
  pause
  exit /b 1
)
echo.
echo Testing Random Forest model...
python ml\predict.py --model ml\model\risk_model.pkl --json "{\"asset_age_years\":2,\"wear_level\":1,\"corrosion_level\":0,\"crack_level\":0,\"deformation_level\":0,\"vibration_level\":1,\"temperature_c\":30,\"maintenance_count\":0,\"previous_failures\":0,\"days_since_last_inspection\":5}"
if errorlevel 1 (
  echo.
  echo Model test failed.
  pause
  exit /b 1
)
echo.
echo RAILKAVACH ML + YOLO environment is ready.
pause
