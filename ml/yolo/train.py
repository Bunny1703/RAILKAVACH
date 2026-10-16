import argparse
from pathlib import Path
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser(description='Train the RAILKAVACH railway-defect YOLO model')
    ap.add_argument('--data', required=True, help='YOLO data.yaml')
    ap.add_argument('--base-model', default='yolo11n.pt')
    ap.add_argument('--epochs', type=int, default=100)
    ap.add_argument('--imgsz', type=int, default=960)
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--project', default='ml/model')
    ap.add_argument('--name', default='railway_defect')
    ap.add_argument('--device', default=None)
    args = ap.parse_args()

    data = Path(args.data).resolve()
    if not data.is_file():
        raise FileNotFoundError(f'Dataset config not found: {data}')

    model = YOLO(args.base_model)
    train_args = dict(
        data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        project=args.project, name=args.name, patience=25, workers=0,
        cache=False, pretrained=True, optimizer='auto',
        cos_lr=True, close_mosaic=10,
        hsv_h=0.015, hsv_s=0.55, hsv_v=0.45,
        degrees=5.0, translate=0.08, scale=0.35, shear=1.0,
        fliplr=0.5, mosaic=0.8, mixup=0.05,
    )
    if args.device:
        train_args['device'] = args.device

    result = model.train(**train_args)
    best = Path(result.save_dir) / 'weights' / 'best.pt'
    print(f'Best model: {best}')
    print('Copy the validated best.pt to ml/model/railway_defect_yolo.pt')


if __name__ == '__main__':
    main()
