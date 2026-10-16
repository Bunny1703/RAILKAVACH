# RAILKAVACH railway visual inspection

## Important model rule

`yolo11n.pt` is a general-purpose YOLO model. It is **not** a railway-defect model and is intentionally blocked from producing railway defect predictions.

The application expects a trained model at:

`ml/model/railway_defect_yolo.pt`

The model must contain supported railway-defect classes such as:

- `crack`
- `corrosion`
- `deformation`
- `wear`
- `spalling`
- `corrugation`
- `missing_fastener`
- `rail_break`

Class names are normalized through aliases in `worker.py`.

## Why the old result was wrong

The old pipeline converted YOLO confidence directly into physical severity. For example, a 0.90 confidence detection was treated as severity 4. Confidence means **how strongly the model believes the class is present**; it does not mean the physical defect is severe.

The new pipeline separates:

1. detection confidence
2. defect class
3. application severity mapping
4. visual risk

It also rejects models that do not expose railway-defect classes.

## Train a real model

Prepare a YOLO dataset with train/val/test images and labels, then run:

```bash
python ml/yolo/train.py --data ml/yolo/data.yaml --epochs 100 --imgsz 960
```

For the dataset, Rail-5k is a real-world railway surface-defect dataset with 5,000 RGB images and 1,100 annotated images, including crack, spalling, corrugation and fastening-related categories. Access to the Zenodo files is restricted and must be obtained legitimately. Do not claim the resulting model is Indian-Railways-specific without authorized Indian railway data.

## Production rule

A visual result should be treated as inspection decision-support, not as a replacement for a qualified railway inspector. Validate recall, precision, mAP, false-negative rate and performance on an independent field-like test set before operational use.

## Railway Track Surface Faults ZIP supplied for RAILKAVACH

The supplied dataset is **folder-labelled classification data** with these classes:
`Cracks`, `Flakings`, `Grooves`, `Joints`, `Shellings`, `Spallings`, `Squats`.
It does not contain bounding-box annotations. Therefore it should be trained as an
image classifier using `prepare_surface_classification.py` and
`train_surface_classifier.py`. Do not convert a folder label into a fake bounding
box; that would create misleading detection results.
