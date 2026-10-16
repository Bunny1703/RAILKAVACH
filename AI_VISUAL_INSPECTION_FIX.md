# AI Visual Inspection Fix

## What was wrong

The previous visual pipeline could fall back to the bundled `yolo11n.pt` model. A general YOLO model is not trained to classify railway defects. It also converted detection confidence directly into a physical severity level and, in the old `ai_inspection.py`, fed invented structured values into the risk model.

## What is fixed

- Generic YOLO models are blocked from railway-defect prediction.
- A railway-specific model must contain supported railway-defect classes.
- Detection confidence is kept separate from physical defect severity.
- Unsupported classes are ignored instead of being mislabeled as defects.
- Visual evidence no longer invents asset age, temperature, maintenance count, previous failures, or inspection age.
- YOLO inference uses 960px input, IoU 0.45, stronger default confidence and test-time augmentation.
- Visual condition fields are populated only from validated railway defect detections.
- The existing structured ML ensemble remains separate.

## Required model

Place the validated model here:

`ml/model/railway_defect_yolo.pt`

The project intentionally does not pretend that the bundled `yolo11n.pt` is a railway model.

## Training

Use `ml/yolo/train.py` with a properly annotated railway dataset. The Rail-5k dataset is a relevant research dataset: it contains 5,000 RGB railway images and 1,100 annotated images covering several rail defects/accessories. Its Zenodo files are currently access-restricted, so obtain access through the dataset owner rather than bypassing it.

Before using the model operationally, evaluate it on an independent field-like test set and report precision, recall, mAP and false-negative rate.
