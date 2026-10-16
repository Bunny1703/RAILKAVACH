@echo off
setlocal
cd /d "%~dp0.."
set "DATA_ZIP=%~1"
if "%DATA_ZIP%"=="" set /p "DATA_ZIP=Enter full path to Railway Track Surface Faults Dataset.zip: "
if not exist "%DATA_ZIP%" (
  echo Dataset ZIP not found: %DATA_ZIP%
  pause
  exit /b 1
)
if not exist "ml\datasets" mkdir "ml\datasets"
set "EXTRACT=ml\datasets\RailwayTrackSurfaceFaults"
if not exist "%EXTRACT%" mkdir "%EXTRACT%"
echo Extracting dataset...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%DATA_ZIP%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 exit /b 1
set "SOURCE=%EXTRACT%\Railway Track Surface Faults Dataset"
if not exist "%SOURCE%" set "SOURCE=%EXTRACT%"
echo Preparing train/validation/test folders...
python ml\yolo\prepare_surface_classification.py --input "%SOURCE%" --output ml\yolo\surface_classification
if errorlevel 1 exit /b 1
echo Training railway surface classifier...
python ml\yolo\train_surface_classifier.py --data ml\yolo\surface_classification --epochs 60 --imgsz 224 --batch 32
if errorlevel 1 exit /b 1
echo.
echo Training finished. Validate the model before operational use.
echo Copy the best model to: ml\model\railway_surface_classifier.pt
pause
