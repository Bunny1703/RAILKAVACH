# RAILKAVACH V4 — YOLO performance + reliability update

## Optimized YOLO pipeline

1. **Permanent fix for Windows `spawn ENAMETOOLONG`**
   - The Node endpoint never passes image Base64 to a child-process command line.
   - Images are decoded into a temporary file.
   - Python receives only the short temporary file path.
   - Request size is validated before the file is created.

2. **Persistent YOLO worker**
   - Python is started once and the YOLO model is loaded once.
   - Subsequent inspections reuse the same loaded model.
   - This avoids starting Python + loading the `.pt` model on every click.
   - The worker performs a one-time warm-up and uses `imgsz=640`, `max_det=20`, and `workers=0` for predictable single-image inference.
   - If the worker crashes or times out, the next request automatically starts a fresh worker.

3. **Browser-side image optimization**
   - Large images are resized to a maximum 1600px side before upload.
   - Images are converted to JPEG and compressed to a maximum of about 2.5 MB.
   - This reduces upload time and memory use while keeping enough detail for the YOLO 640px inference pipeline.
   - The original selected image is still used for the UI preview.

4. **Duplicate-click protection**
   - The Analyze button cannot start a second prediction while one is already running.

5. **Validation and cleanup**
   - JPG, PNG and WebP file signatures are checked server-side.
   - Temporary files are always removed in `finally`.
   - Prediction timeouts restart the worker so a stuck inference cannot block future inspections.

## Local run

1. Copy `.env.example` to `.env` and fill your own Supabase/Google values.
2. Run `npm install`.
3. Install Python dependencies:
   `python -m pip install -r ml/requirements.txt`
4. Start:
   `npm run dev`
5. Open:
   `http://localhost:3000`

The bundled `yolo11n.pt` is a general YOLO demo model. It is not trained for railway defects. For real railway defect classes, add:
`ml/model/railway_defect_yolo.pt`

## Deployment note

The optimized worker is designed for the local Windows/Node server flow used by this project. A serverless platform such as Netlify should not be expected to run Python + Ultralytics + the `.pt` model inside a short-lived Node function. For production deployment, use a dedicated Python inference service or a compatible native inference runtime while keeping `/api/yolo/predict` as the frontend contract.
