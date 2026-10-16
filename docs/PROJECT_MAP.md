# Project Map

| Area | File | Purpose |
|---|---|---|
| Frontend | `index.html` | Dashboard sections and AI inspection screen |
| Frontend | `app.js` | UI controllers, API calls, inspection workflow |
| Styling | `styles.css` | Responsive dashboard and AI inspection UI |
| Backend | `server.js` | Local API adapter |
| API | `netlify/functions/yolo-predict.js` | Authenticated YOLO inference endpoint |
| CV API | `netlify/functions/yolo-predict.js` | Authenticated image validation, temp-file handling and persistent worker management |
| CV Worker | `ml/yolo/worker.py` | Long-lived YOLO model process; loads model once and handles inference requests |
| CV CLI | `ml/yolo/predict.py` | Standalone optimized YOLO inference |
| Risk ML | `ml/ai_inspection.py` | YOLO + Random Forest workflow |
