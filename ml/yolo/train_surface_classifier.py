"""Train a YOLO image-classification model from the Railway Track Surface Faults dataset.

Run after installing ml/requirements.txt:
  python ml/yolo/train_surface_classifier.py --data ml/yolo/surface_classification

This produces a classification model, not bounding boxes. Use it for image-level
railway surface-fault classification unless/ until a bounding-box dataset is available.
"""
import argparse
from pathlib import Path
from ultralytics import YOLO


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--base-model', default='yolo11n-cls.pt')
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--imgsz', type=int, default=224)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--project', default='ml/model')
    ap.add_argument('--name', default='railway_surface_classifier')
    ap.add_argument('--device', default=None)
    args=ap.parse_args()
    data=Path(args.data).resolve()
    if not (data/'train').is_dir(): raise FileNotFoundError(f'Missing train folder: {data}')
    model=YOLO(args.base_model)
    kw=dict(data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
            project=args.project, name=args.name, patience=15, workers=0,
            cache=False, pretrained=True, cos_lr=True, verbose=True)
    if args.device: kw['device']=args.device
    model.train(**kw)
    print('Copy the validated best.pt to ml/model/railway_surface_classifier.pt')

if __name__=='__main__': main()
