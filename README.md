# RAILKAVACH

Railway asset inspection and risk-monitoring prototype built with Node.js, Supabase, Python, YOLO and a Random Forest risk model.

## What to demo

1. Sign in.
2. Open **AI Visual Inspection** from the sidebar.
3. Choose a JPG/PNG/WebP image.
4. Click **Analyze image**.
5. Review detections, confidence, bounding boxes and visual-risk level.
6. Use **Record inspection** to continue into the inspection workflow.

## Architecture

```text
Browser → Express → Netlify-style function → Python YOLO → JSON result
                                      ↓
                              Supabase / risk workflow
```

## ML status

`ml/model/railway_surface_classifier.pt or ml/model/railway_defect_yolo.pt` is the intended railway-specific model. If it is not present, local development falls back to the bundled `yolo11n.pt` demo model. A general YOLO model must not be presented as a trained railway-defect detector.

## Run locally

```bash
npm install
python -m pip install -r ml/requirements.txt
copy .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Deploy on Render

`render.yaml` installs the Python dependencies into `.venv` during the build and starts the Node.js server. If configuring an existing Render service manually, use this build command:

```bash
npm install && python3 -m venv .venv && .venv/bin/python -m pip install -r ml/requirements.txt
```

Set the start command to `npm start`. The server automatically uses `.venv/bin/python` for risk and YOLO predictions.

## Project structure

- `index.html` — dashboard UI
- `app.js` — frontend controllers and API interactions
- `styles.css` — dashboard styling
- `server.js` — local Express adapter
- `netlify/functions/` — backend functions
- `ml/yolo/` — computer-vision inference
- `ml/model/` — Random Forest and optional railway YOLO weights
- `docs/` — concise architecture and demo notes

## Security

Never commit `.env`, Supabase secret/service-role keys, or other credentials.

## Quick Supabase diagnostic

After configuring `.env`, run `npm run dev` and visit `/api/health/supabase`. This endpoint verifies that the server can reach the Supabase `users` table without exposing credentials.
