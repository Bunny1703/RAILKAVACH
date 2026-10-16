"""Persistent railway-defect YOLO inference worker.

Important: the bundled yolo11n.pt is a general-purpose COCO model and MUST NOT
be interpreted as a railway-defect detector. A railway-specific model is
required for visual defect predictions.
"""
import argparse
import json
import sys
import traceback
from pathlib import Path

SUPPORTED_ALIASES = {
    "crack": "crack", "rail_crack": "crack", "fracture": "crack",
    "broken_rail": "rail_break", "rail_break": "rail_break", "break": "rail_break",
    "corrosion": "corrosion", "rust": "corrosion", "corroded": "corrosion",
    "deformation": "deformation", "bend": "deformation", "bent": "deformation",
    "distortion": "deformation", "misalignment": "deformation",
    "wear": "wear", "worn": "wear", "surface_wear": "wear",
    "spalling": "spalling", "spall": "spalling",
    "wheel_burn": "wheel_burn", "wheelburn": "wheel_burn", "wheel_burns": "wheel_burn",
    "corrugation": "corrugation", "corrugated": "corrugation",
    "flaking": "flaking", "flakings": "flaking",
    "shelling": "shelling", "shellings": "shelling",
    "squat": "squat", "squats": "squat",
    "groove": "groove", "grooves": "groove",
    "joint": "joint", "joints": "joint",
    "missing_fastener": "missing_fastener", "missing_fasteners": "missing_fastener",
    "loose_fastener": "loose_fastener", "fastener_damage": "fastener_damage",
}

# These are application severity mappings, not model confidence.
BASE_SEVERITY = {
    "rail_break": 4,
    "crack": 3,
    "spalling": 3,
    "deformation": 3,
    "missing_fastener": 3,
    "fastener_damage": 2,
    "corrosion": 2,
    "wear": 2,
    "corrugation": 2,
    "flaking": 2, "shelling": 2, "squat": 3, "groove": 1, "joint": 1,
}


def log(message):
    print(f"[YOLO worker] {message}", file=sys.stderr, flush=True)


def normalize_name(name):
    return str(name).lower().strip().replace("-", "_").replace(" ", "_")


def canonical_class(name):
    n = normalize_name(name)
    return SUPPORTED_ALIASES.get(n)


def model_classes(model):
    names = getattr(model, "names", {}) or {}
    if isinstance(names, list):
        names = {i: value for i, value in enumerate(names)}
    return [str(v) for v in names.values()]


def is_railway_model(model_path, model):
    """Require at least one supported railway-defect class in the model."""
    classes = model_classes(model)
    supported = [canonical_class(x) for x in classes]
    return any(x in BASE_SEVERITY for x in supported), classes


def load_model(model_path):
    from ultralytics import YOLO
    model = YOLO(str(model_path))
    try:
        model.fuse()
    except Exception:
        pass
    return model


def risk_from_detections(detections):
    if not detections:
        return "INCONCLUSIVE"

    # A defect's confidence is not its physical severity. We use the class
    # semantics first and confidence only to suppress weak detections.
    strong = [d for d in detections if float(d["confidence"]) >= 0.50]
    if not strong:
        return "REVIEW_REQUIRED"
    highest = max(int(d["severity"]) for d in strong)

    # Multiple independent moderate defects can raise the inspection priority.
    if highest >= 4:
        return "CRITICAL"
    if highest >= 3:
        return "HIGH"
    if len(strong) >= 2:
        return "HIGH"
    return "MEDIUM"


def condition_levels(detections):
    levels = {
        "crack_level": 0,
        "corrosion_level": 0,
        "deformation_level": 0,
        "wear_level": 0,
    }
    field_map = {
        "crack": "crack_level", "rail_break": "crack_level",
        "corrosion": "corrosion_level", "deformation": "deformation_level",
        "wear": "wear_level", "spalling": "wear_level", "wheel_burn": "wear_level", "corrugation": "wear_level",
        "flaking": "wear_level", "shelling": "wear_level", "groove": "wear_level",
        "squat": "deformation_level", "joint": "deformation_level",
        "missing_fastener": "deformation_level", "fastener_damage": "deformation_level",
    }
    for d in detections:
        field = field_map.get(d["canonical_class"])
        if not field:
            continue
        # Map model confidence to evidence strength, but cap it at 4.
        c = float(d["confidence"])
        evidence = 1 if c < 0.50 else 2 if c < 0.70 else 3 if c < 0.85 else 4
        levels[field] = max(levels[field], evidence)
    return levels


def predict(model, image_path, confidence, model_path=None):
    railway_model, classes = is_railway_model(model_path, model)
    if not railway_model:
        raise RuntimeError(
            "The selected YOLO model is not a railway-defect model. "
            "Its classes do not include supported railway defects. "
            "Train/install ml/model/railway_defect_yolo.pt before using AI visual inspection."
        )

    results = model.predict(
        source=image_path,
        imgsz=960,
        conf=confidence,
        iou=0.45,
        max_det=30,
        verbose=False,
        workers=0,
        augment=True,
    )

    detections = []
    ignored = 0
    for result in results:
        names = result.names
        # The uploaded Railway Track Surface Faults dataset is folder-labelled
        # (image classification), not bounding-box annotated. Support a YOLO
        # classification model without pretending it has defect boxes.
        probs = getattr(result, "probs", None)
        if probs is not None and getattr(model, "task", "") == "classify":
            top_id = int(probs.top1)
            conf = float(probs.top1conf.item())
            raw_name = str(names.get(top_id, top_id)) if isinstance(names, dict) else str(names[top_id])
            canonical = canonical_class(raw_name)
            if canonical is not None and conf >= confidence:
                detections.append({
                    "class": raw_name,
                    "canonical_class": canonical,
                    "confidence": round(conf, 4),
                    "severity": BASE_SEVERITY[canonical],
                    "bbox": None,
                    "source_type": "image_classification",
                })
            elif canonical is None:
                ignored += 1
            continue
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            cls_id = int(box.cls.item())
            raw_name = str(names.get(cls_id, cls_id)) if isinstance(names, dict) else str(names[cls_id])
            canonical = canonical_class(raw_name)
            conf = float(box.conf.item())
            if canonical is None:
                ignored += 1
                continue
            if conf < confidence:
                continue
            detections.append({
                "class": raw_name,
                "canonical_class": canonical,
                "confidence": round(conf, 4),
                "severity": BASE_SEVERITY[canonical],
                "bbox": [round(float(x), 2) for x in box.xyxy[0].tolist()],
            })

    detections.sort(key=lambda d: (d["severity"], d["confidence"]), reverse=True)
    levels = condition_levels(detections)
    max_conf = max((d["confidence"] for d in detections), default=0.0)
    risk = risk_from_detections(detections)

    return {
        "detections": detections,
        "count": len(detections),
        "ignored_unsupported_detections": ignored,
        "confidence": round(max_conf * 100, 2),
        "condition_levels": levels,
        "visual_risk_level": risk,
        "review_required": risk in {"INCONCLUSIVE", "REVIEW_REQUIRED"},
        "model_is_railway_specific": True,
        "model_classes": classes,
        "model_task": getattr(model, "task", "detect"),
        "model_note": "Railway-specific model; classification datasets provide image-level evidence, while detection datasets provide bounding boxes.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--warmup", action="store_true")
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"YOLO model not found: {model_path}")

    log(f"Loading model: {model_path.name}")
    model = load_model(model_path)
    railway, classes = is_railway_model(model_path, model)
    if not railway:
        raise RuntimeError(
            f"Model {model_path.name} is not railway-specific. Model classes: {classes}. "
            "Use a trained railway_defect_yolo.pt model."
        )
    log(f"Model loaded. Railway defect classes: {classes}")

    if args.warmup:
        try:
            import numpy as np
            model.predict(source=np.zeros((960, 960, 3), dtype=np.uint8), imgsz=960,
                          conf=0.25, max_det=1, verbose=False, workers=0)
            log("Warm-up complete.")
        except Exception as exc:
            log(f"Warm-up skipped: {exc}")

    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            image_path = str(request.get("image_path") or "")
            confidence = float(request.get("confidence", 0.35))
            confidence = max(0.20, min(0.85, confidence))
            if not image_path:
                raise ValueError("No image path was provided.")
            image_file = Path(image_path)
            if not image_file.is_file():
                raise FileNotFoundError("Temporary inspection image is missing.")
            if image_file.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                raise ValueError("Temporary inspection image has no supported image extension.")
            result = predict(model, str(image_file), confidence, model_path)
            result["ok"] = True
            result["id"] = request_id
            print(json.dumps(result, separators=(",", ":")), flush=True)
        except Exception as exc:
            log(f"Prediction failed: {exc}")
            print(json.dumps({"ok": False, "id": request_id, "error": str(exc),
                              "trace": traceback.format_exc(limit=2)}, separators=(",", ":")), flush=True)


def cli():
    ap = argparse.ArgumentParser(description="RAILKAVACH railway-defect YOLO predictor")
    ap.add_argument("--model", required=True)
    ap.add_argument("--image", required=True)
    ap.add_argument("--confidence", type=float, default=0.25)
    args = ap.parse_args()
    model_path = Path(args.model).resolve()
    model = load_model(model_path)
    result = predict(model, str(Path(args.image).resolve()), max(0.05, min(0.95, args.confidence)), model_path)
    print(json.dumps(result))


if __name__ == "__main__":
    cli()
