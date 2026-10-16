"""Prepare a folder-labelled railway surface dataset for YOLO classification.

Input layout:
  Railway Track Surface Faults Dataset/Cracks/*.JPEG
  Railway Track Surface Faults Dataset/Flakings/*.JPEG
  ...

Output layout:
  <output>/train/<class>/*.JPEG
  <output>/val/<class>/*.JPEG
  <output>/test/<class>/*.JPEG

This dataset is image-level classification data, not bounding-box detection data.
"""
import argparse, random, shutil
from pathlib import Path


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', default='ml/yolo/surface_classification')
    ap.add_argument('--val', type=float, default=0.15)
    ap.add_argument('--test', type=float, default=0.15)
    ap.add_argument('--seed', type=int, default=42)
    args=ap.parse_args()
    src=Path(args.input).resolve(); out=Path(args.output).resolve()
    if not src.is_dir(): raise FileNotFoundError(src)
    rng=random.Random(args.seed)
    classes=sorted([p for p in src.iterdir() if p.is_dir()])
    for cdir in classes:
        files=[p for p in cdir.iterdir() if p.is_file()]
        rng.shuffle(files)
        n=len(files); nv=int(n*args.val); nt=int(n*args.test); ntrain=n-nv-nt
        splits={'train':files[:ntrain], 'val':files[ntrain:ntrain+nv], 'test':files[ntrain+nv:]}
        for split, items in splits.items():
            dest=out/split/cdir.name; dest.mkdir(parents=True,exist_ok=True)
            for i,p in enumerate(items):
                target=dest/p.name
                if target.exists(): target=dest/f'{i}_{p.name}'
                shutil.copy2(p,target)
        print(f'{cdir.name}: train={ntrain} val={nv} test={nt}')
    print(f'Prepared classification dataset at {out}')

if __name__=='__main__': main()
