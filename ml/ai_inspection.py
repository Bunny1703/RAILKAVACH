"""RAILKAVACH AI visual inspection.

This module intentionally does not invent structured inspection measurements
from an image. Visual YOLO evidence and structured risk ML remain separate.
"""
import argparse
import json
from pathlib import Path
from ultralytics import YOLO

from yolo.worker import predict, load_model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--yolo-model", default="ml/model/railway_defect_yolo.pt")
    parser.add_argument("--confidence", type=float, default=0.35)
    args = parser.parse_args()

    model_path = Path(args.yolo_model).resolve()
    if not model_path.is_file():
        raise FileNotFoundError(
            f"Railway-specific YOLO model not found: {model_path}. "
            "Add ml/model/railway_defect_yolo.pt after training a railway dataset."
        )

    model = load_model(model_path)
    result = predict(model, str(Path(args.image).resolve()), max(0.20, min(0.85, args.confidence)))
    result["structured_ml_run"] = False
    result["structured_ml_note"] = (
        "Visual inspection is kept separate from the structured Random Forest/ensemble. "
        "Provide complete inspection measurements to run structured risk prediction."
    )
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
