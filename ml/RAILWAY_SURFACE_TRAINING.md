# RAILKAVACH — Railway Track Surface Faults training

The supplied ZIP is a **folder-labelled image classification dataset**:

- Cracks
- Flakings
- Grooves
- Joints
- Shellings
- Spallings
- Squats

It does **not** contain bounding boxes. Therefore the correct use of this dataset is
an image-level classifier, not a YOLO object detector. Training it as a detector by
inventing boxes would create false localization results.

## One-click Windows training

After installing dependencies:

```bat
ml\setup-ml.bat
```

Then:

```bat
ml\train_railway_surface.bat "C:\Users\Admin\Downloads\Railway Track Surface Faults Dataset.zip"
```

The script prepares train/validation/test folders and trains `yolo11n-cls.pt`.
The validated output should be copied to:

```text
ml/model/railway_surface_classifier.pt
```

## Important dataset limitation

The classes are highly imbalanced. Cracks, grooves and joints have very few images,
so the model may not generalize reliably to those classes. Also, many images are
frames from the same source videos; a random frame split can therefore give overly
optimistic validation results. Treat the reported metrics as prototype metrics and
validate with an independent field-like set before making operational claims.

## Production model

For bounding boxes around defects, use a separate railway dataset with **object-level
annotations** and train `ml/yolo/train.py`. The classification model gives image-level
fault evidence only.
