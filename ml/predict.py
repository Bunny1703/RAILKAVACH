"""Predict RAILKAVACH asset risk from structured inspection features."""
import argparse
import json
import math
import sys
import traceback
from pathlib import Path

try:
    import joblib
    import numpy as np
    import pandas as pd
except ImportError as err:
    sys.stderr.write(f"ERROR: Failed to import ML dependencies in Python executable '{sys.executable}': {err}\n")
    traceback.print_exc(file=sys.stderr)
    sys.exit(2)

CLASS_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
CLASS_SCORE = {'LOW': 10.0, 'MEDIUM': 35.0, 'HIGH': 65.0, 'CRITICAL': 90.0}


def aligned_proba(model, row):
    raw = model.predict_proba(row)[0]
    out = np.zeros(len(CLASS_ORDER), dtype=float)
    for cls, p in zip(model.classes_, raw):
        label = str(cls).upper()
        if label in CLASS_ORDER:
            out[CLASS_ORDER.index(label)] = float(p)
    return out


def main():
    parser = argparse.ArgumentParser(description="RAILKAVACH Asset Risk Predictor")
    parser.add_argument('--model', required=True, help="Path to risk_model.pkl bundle")
    parser.add_argument('--json', required=True, help='JSON object containing feature values')
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    if not model_path.is_file():
        sys.stderr.write(f"ERROR: Model file does not exist at '{args.model}' (resolved: '{model_path}')\n")
        sys.exit(1)

    try:
        payload = json.loads(args.json)
    except json.JSONDecodeError as err:
        sys.stderr.write(f"ERROR: Invalid JSON feature payload: {err}\n")
        sys.exit(1)

    try:
        bundle = joblib.load(str(model_path))
    except Exception as err:
        sys.stderr.write(f"ERROR: Failed to unpickle risk model bundle '{model_path}' in Python '{sys.executable}': {err}\n")
        traceback.print_exc(file=sys.stderr)
        if "_loss" in str(err) or "InconsistentVersionWarning" in str(err):
            sys.stderr.write(
                "Hint: This model was serialized with a specific scikit-learn version. "
                "Install the compatible version from ml/requirements.txt before running the predictor.\n"
            )
        sys.exit(3)

    features = list(bundle.get('features', []))
    models = bundle.get('models') or [bundle.get('model')]
    models = [m for m in models if m is not None]
    if not features or not models:
        raise ValueError(f"Invalid model bundle '{model_path}': features or models are missing.")

    values = {}
    for f in features:
        value = payload.get(f, 0)
        try:
            value = float(value)
        except (TypeError, ValueError):
            value = 0.0
        if not math.isfinite(value):
            value = 0.0
        values[f] = value

    row = pd.DataFrame([values], columns=features)
    probs = np.mean([aligned_proba(model, row) for model in models], axis=0)
    probs = probs / probs.sum() if probs.sum() > 0 else np.ones(len(CLASS_ORDER)) / len(CLASS_ORDER)

    idx = int(np.argmax(probs))
    label = CLASS_ORDER[idx]

    # Conservative input guardrail: an extreme condition measurement should
    # not be silently reported as LOW just because the prototype training set
    # contains unusual combinations. This is a safety-oriented application
    # rule, not a claim about ML accuracy. It can be replaced with validated
    # engineering thresholds when real railway data/standards are available.
    condition_fields = ['wear_level', 'corrosion_level', 'crack_level', 'deformation_level', 'vibration_level']
    extreme_count = sum(values[f] >= 4 for f in condition_fields)
    if extreme_count >= 3:
        label = 'CRITICAL'
    elif extreme_count >= 2 and label in {'LOW', 'MEDIUM'}:
        label = 'HIGH'
    elif any(values[f] >= 5 for f in condition_fields) and label == 'LOW':
        label = 'HIGH'

    selected_idx = CLASS_ORDER.index(label)
    model_confidence = float(probs[int(np.argmax(probs))] * 100)
    selected_probability = float(probs[selected_idx] * 100)
    risk_score = float(sum(probs[i] * CLASS_SCORE[c] for i, c in enumerate(CLASS_ORDER)))
    if label == 'HIGH' and risk_score < 50:
        risk_score = 50.0
    if label == 'CRITICAL' and risk_score < 75:
        risk_score = 75.0

    # A simple probability margin is useful to show when the model is uncertain.
    sorted_probs = np.sort(probs)[::-1]
    margin = float((sorted_probs[0] - sorted_probs[1]) * 100) if len(sorted_probs) > 1 else model_confidence

    probability_map = {c: round(float(p) * 100, 2) for c, p in zip(CLASS_ORDER, probs)}
    top_factors = []
    meta = bundle.get('metadata', {})
    importance = meta.get('feature_importance', {})
    for feature, score in sorted(importance.items(), key=lambda x: x[1], reverse=True)[:5]:
        value = values.get(feature)
        top_factors.append({'feature': feature, 'value': value, 'importance': round(float(score), 4)})

    print(json.dumps({
        'risk_level': label,
        'risk_score': round(max(0.0, min(100.0, risk_score)), 2),
        'confidence': round(model_confidence, 2),
        'selected_class_probability': round(selected_probability, 2),
        'probabilities': probability_map,
        'probability_margin': round(margin, 2),
        'models_used': len(models),
        'method': 'tree-ensemble-ml-with-safety-guardrail',
        'guardrail_applied': label != CLASS_ORDER[int(np.argmax(probs))],
        'top_model_features': top_factors,
        'training_source': meta.get('dataset_source_counts', {}),
        'prototype_warning': meta.get('prototype_warning'),
    }))


if __name__ == '__main__':
    main()
