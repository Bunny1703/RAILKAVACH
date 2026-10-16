# RAILKAVACH ML Prediction Upgrade

## What was improved

1. Replaced the single Random Forest prediction path with a soft-voting tree ensemble:
   - Random Forest
   - Extra Trees
   - HistGradientBoosting
2. Added 5-fold cross-validation and holdout evaluation during training.
3. Added probability-based risk scoring instead of only mapping the predicted class to a fixed score.
4. Added probability margin and model confidence output.
5. Added model feature-importance information for explainability.
6. Added numeric input sanitization and robust model-bundle validation.
7. Added a conservative application guardrail for extreme condition values. This is explicitly an application rule, not a claim about learned model accuracy.
8. Fixed `ml/ai_inspection.py`: it no longer fills missing asset/history/temperature fields with invented constants before calling the risk model.
9. The backend now recognizes the new ensemble prediction method.

## Current validation

The included dataset contains 2,400 rows and is labeled `synthetic_demo`. The upgraded ensemble achieved approximately 98.75% holdout accuracy and 98.75% macro-F1 on the current synthetic dataset.

These numbers are **not railway field accuracy**. The dataset is synthetic and evenly distributed across LOW/MEDIUM/HIGH/CRITICAL. A production model needs representative, properly labeled railway inspection/maintenance data and an unseen field-like test set.

## Important next step

Train the same pipeline using real/authorized railway inspection data. Keep a completely independent test set and report per-class precision, recall, F1, confusion matrix and appropriate safety-oriented metrics.
