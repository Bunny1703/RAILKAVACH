"""Predict RAILKAVACH asset risk from structured inspection features."""
import argparse
import json
import math
import sys
import time
import traceback
from pathlib import Path

CLASS_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
CLASS_SCORE = {'LOW': 10.0, 'MEDIUM': 35.0, 'HIGH': 65.0, 'CRITICAL': 90.0}
DIAGNOSTIC_FEATURES = {
    'asset_age_years': 2,
    'wear_level': 1,
    'corrosion_level': 0,
    'crack_level': 0,
    'deformation_level': 0,
    'vibration_level': 1,
    'temperature_c': 30,
    'maintenance_count': 0,
    'previous_failures': 0,
    'days_since_last_inspection': 5,
}


def load_dependencies():
    import joblib
    import numpy as np
    import pandas as pd
    return joblib, np, pd


def aligned_proba(model, row, np):
    raw = model.predict_proba(row)[0]
    out = np.zeros(len(CLASS_ORDER), dtype=float)
    for cls, p in zip(model.classes_, raw):
        label = str(cls).upper()
        if label in CLASS_ORDER:
            out[CLASS_ORDER.index(label)] = float(p)
    return out


def predict_bundle(bundle, payload, np, pd, model_path):
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
    probs = np.mean([aligned_proba(model, row, np) for model in models], axis=0)
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

    return {
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
    }


def emit_stage(stage, status, elapsed_ms, error_category=None):
    event = {
        'type': 'stage',
        'stage': stage,
        'status': status,
        'elapsed_ms': max(0, round(elapsed_ms)),
    }
    if error_category:
        event['error_category'] = error_category
    print(json.dumps(event), flush=True)


def run_diagnostic(model_path):
    dependencies_started = time.perf_counter()
    emit_stage('dependency_import', 'started', 0)
    try:
        joblib, np, pd = load_dependencies()
    except Exception:
        emit_stage(
            'dependency_import',
            'failed',
            (time.perf_counter() - dependencies_started) * 1000,
            'dependency_import_failed',
        )
        return 2
    emit_stage(
        'dependency_import',
        'completed',
        (time.perf_counter() - dependencies_started) * 1000,
    )

    loading_started = time.perf_counter()
    emit_stage('model_loading', 'started', 0)
    try:
        bundle = joblib.load(str(model_path))
    except Exception:
        emit_stage(
            'model_loading',
            'failed',
            (time.perf_counter() - loading_started) * 1000,
            'model_loading_failed',
        )
        return 3
    emit_stage(
        'model_loading',
        'completed',
        (time.perf_counter() - loading_started) * 1000,
    )

    inference_started = time.perf_counter()
    emit_stage('inference', 'started', 0)
    try:
        predict_bundle(bundle, DIAGNOSTIC_FEATURES, np, pd, model_path)
    except Exception:
        emit_stage(
            'inference',
            'failed',
            (time.perf_counter() - inference_started) * 1000,
            'inference_failed',
        )
        return 4
    emit_stage('inference', 'completed', (time.perf_counter() - inference_started) * 1000)
    return 0


def main():
    parser = argparse.ArgumentParser(description="RAILKAVACH Asset Risk Predictor")
    parser.add_argument('--model', required=True, help="Path to risk_model.pkl bundle")
    parser.add_argument('--json', help='JSON object containing feature values')
    parser.add_argument('--diagnostic', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    if not model_path.is_file():
        if args.diagnostic:
            emit_stage('model_loading', 'failed', 0, 'model_loading_failed')
            return 3
        sys.stderr.write(f"ERROR: Model file does not exist at '{args.model}' (resolved: '{model_path}')\n")
        return 1

    if args.diagnostic:
        return run_diagnostic(model_path)

    if args.json is None:
        parser.error('--json is required unless --diagnostic is specified')

    try:
        payload = json.loads(args.json)
    except json.JSONDecodeError as err:
        sys.stderr.write(f"ERROR: Invalid JSON feature payload: {err}\n")
        return 1

    try:
        joblib, np, pd = load_dependencies()
    except ImportError as err:
        sys.stderr.write(f"ERROR: Failed to import ML dependencies in Python executable '{sys.executable}': {err}\n")
        traceback.print_exc(file=sys.stderr)
        return 2

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
        return 3

    print(json.dumps(predict_bundle(bundle, payload, np, pd, model_path)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
