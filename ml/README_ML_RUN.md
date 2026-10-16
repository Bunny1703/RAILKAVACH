# RAILKAVACH ML Risk - Local Setup

## What is now connected

Inspection measurements saved from the UI are used by the risk API. The backend reads the latest inspection for an asset, builds the Random Forest feature vector, calls `ml/predict.py`, and returns the ML risk level, confidence, probabilities, and score.

## First-time Windows setup

From the `RAILKAVACH` folder:

```cmd
python -m pip install -r ml\requirements.txt
```

Or double-click:

```text
ml\setup-ml.bat
```

Then start the app:

```cmd
npm run dev
```

## Test the model without the website

```cmd
python ml\predict.py --model ml\model\risk_model.pkl --json "{\"asset_age_years\":2,\"wear_level\":1,\"corrosion_level\":0,\"crack_level\":0,\"deformation_level\":0,\"vibration_level\":1,\"temperature_c\":30,\"maintenance_count\":0,\"previous_failures\":0,\"days_since_last_inspection\":5}"
```

Expected output contains `risk_level`, `confidence`, and `probabilities`.

## Website flow

```text
New Inspection
    ↓
Supabase inspections
    ↓
Latest structured measurements
    ↓
/api/risk?asset_id=...
    ↓
Random Forest model
    ↓
LOW / MEDIUM / HIGH / CRITICAL
    ↓
Inspection table + asset view + risk report
```

## Important

The bundled model was trained on a **synthetic demonstration dataset**. Its reported test accuracy is not real-world railway safety accuracy and must not be presented as field validation.

For production, retrain with validated railway inspection data and evaluate on a held-out real-world test set.
