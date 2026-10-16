# RAILKAVACH ML Risk Pipeline

This folder is the free/local ML pipeline for the next stage of the project.

## Current application behavior

The web application currently uses a **baseline rule engine** at `/api/risk`. It is intentionally labeled as a baseline, not as ML. It uses live asset status, inspection history, failures, pending inspections, and inspection recency.

## ML model target

The next model should predict:

- LOW
- MEDIUM
- HIGH
- CRITICAL

using structured inspection measurements. Do not claim ML accuracy until the model is trained and evaluated on a real or clearly labeled dataset.

## Training

Install Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Then:

```bash
python train.py --input data/railway_inspections.csv --output model/risk_model.pkl
```

The expected CSV columns are documented in `data/README.md`.
