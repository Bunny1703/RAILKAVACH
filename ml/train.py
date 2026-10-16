"""Train the RAILKAVACH structured risk model.

The project uses a small synthetic prototype dataset at the moment, so this
script focuses on robust validation, probability-based risk scoring and an
ensemble of tree models. The resulting model must still be re-trained and
validated on real, representative railway inspection data before production
safety use.
"""
import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, train_test_split, cross_val_score

FEATURES = [
    'asset_age_years', 'wear_level', 'corrosion_level', 'crack_level',
    'deformation_level', 'vibration_level', 'temperature_c',
    'maintenance_count', 'previous_failures', 'days_since_last_inspection'
]
TARGET = 'risk_level'
CLASS_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']


def make_models(seed=42):
    return [
        RandomForestClassifier(
            n_estimators=800,
            max_depth=None,
            min_samples_leaf=2,
            max_features='sqrt',
            class_weight='balanced_subsample',
            random_state=seed,
            n_jobs=-1,
        ),
        ExtraTreesClassifier(
            n_estimators=800,
            max_depth=None,
            min_samples_leaf=2,
            max_features=0.8,
            class_weight='balanced',
            random_state=seed + 1,
            n_jobs=-1,
        ),
        HistGradientBoostingClassifier(
            max_iter=350,
            learning_rate=0.06,
            max_leaf_nodes=15,
            min_samples_leaf=12,
            l2_regularization=1.0,
            random_state=seed + 2,
        ),
    ]


def validate_data(df):
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        raise ValueError(f'Missing columns: {", ".join(missing)}')

    data = df.copy()
    for col in FEATURES:
        data[col] = pd.to_numeric(data[col], errors='coerce')
    data[TARGET] = data[TARGET].astype(str).str.strip().str.upper()
    data = data.replace([np.inf, -np.inf], np.nan).dropna(subset=FEATURES + [TARGET])
    data = data[data[TARGET].isin(CLASS_ORDER)].copy()

    if len(data) < 100:
        raise ValueError('At least 100 clean labeled rows are recommended for this prototype.')
    if data[TARGET].nunique() < 2:
        raise ValueError('At least two risk classes are required.')
    if data.duplicated(subset=FEATURES + [TARGET]).any():
        data = data.drop_duplicates(subset=FEATURES + [TARGET])
    return data


def aligned_proba(model, X):
    raw = model.predict_proba(X)
    out = np.zeros((len(X), len(CLASS_ORDER)), dtype=float)
    for j, cls in enumerate(model.classes_):
        cls = str(cls).upper()
        if cls in CLASS_ORDER:
            out[:, CLASS_ORDER.index(cls)] = raw[:, j]
    return out


def ensemble_proba(models, X):
    probs = [aligned_proba(m, X) for m in models]
    return np.mean(probs, axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    df = validate_data(pd.read_csv(args.input))
    X = df[FEATURES]
    y = df[TARGET]

    # Holdout is used only for the final reported evaluation.
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=args.seed, stratify=y
    )

    models = make_models(args.seed)
    fitted = []
    for model in models:
        model.fit(X_train, y_train)
        fitted.append(model)

    test_probs = ensemble_proba(fitted, X_test)
    pred = np.array(CLASS_ORDER)[np.argmax(test_probs, axis=1)]
    accuracy = float(accuracy_score(y_test, pred))
    macro_f1 = float(f1_score(y_test, pred, labels=CLASS_ORDER, average='macro'))
    report = classification_report(y_test, pred, labels=CLASS_ORDER, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_test, pred, labels=CLASS_ORDER).tolist()

    # Cross-validation is a more stable estimate than one random split.
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=args.seed)
    cv_scores = []
    for model in make_models(args.seed):
        scores = cross_val_score(model, X, y, cv=cv, scoring='f1_macro', n_jobs=-1)
        cv_scores.append({
            'model': model.__class__.__name__,
            'fold_f1_macro': [round(float(v), 4) for v in scores],
            'mean_f1_macro': round(float(scores.mean()), 4),
        })

    # Final production candidate is fit on all currently available labeled data.
    final_models = make_models(args.seed)
    for model in final_models:
        model.fit(X, y)

    # Average feature importance where available. This is explanatory, not causal.
    importances = []
    for model in final_models:
        if hasattr(model, 'feature_importances_'):
            importances.append(np.asarray(model.feature_importances_, dtype=float))
    mean_importance = np.mean(importances, axis=0) if importances else np.zeros(len(FEATURES))
    feature_importance = {
        f: round(float(v), 6) for f, v in sorted(zip(FEATURES, mean_importance), key=lambda x: x[1], reverse=True)
    }

    source_counts = df['data_source'].value_counts().to_dict() if 'data_source' in df else {}
    metadata = {
        'model_type': 'soft-voting-tree-ensemble',
        'models': ['RandomForestClassifier', 'ExtraTreesClassifier', 'HistGradientBoostingClassifier'],
        'features': FEATURES,
        'classes': CLASS_ORDER,
        'dataset_rows': int(len(df)),
        'dataset_source_counts': {str(k): int(v) for k, v in source_counts.items()},
        'prototype_warning': 'Current dataset is synthetic_demo. Metrics are not field performance.',
        'holdout': {
            'rows': int(len(X_test)),
            'accuracy': round(accuracy, 4),
            'macro_f1': round(macro_f1, 4),
            'classification_report': report,
            'confusion_matrix': cm,
        },
        'cross_validation': cv_scores,
        'feature_importance': feature_importance,
        'risk_score_definition': 'Expected risk score from class probabilities: LOW=10, MEDIUM=35, HIGH=65, CRITICAL=90.',
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        'models': final_models,
        'model': final_models[0],  # backward compatibility with existing code
        'features': FEATURES,
        'classes': CLASS_ORDER,
        'metadata': metadata,
    }
    joblib.dump(bundle, output, compress=3)

    evaluation_path = output.parent / 'evaluation.json'
    evaluation_path.write_text(json.dumps(metadata, indent=2), encoding='utf-8')

    print(f'Rows: {len(df)} | Holdout: {len(X_test)}')
    print(f'Holdout accuracy: {accuracy:.4f}')
    print(f'Holdout macro-F1: {macro_f1:.4f}')
    print(classification_report(y_test, pred, labels=CLASS_ORDER, zero_division=0))
    print(f'Saved ensemble model to {output}')
    print(f'Saved evaluation to {evaluation_path}')


if __name__ == '__main__':
    main()
