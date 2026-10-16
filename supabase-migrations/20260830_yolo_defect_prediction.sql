alter table public.inspections add column if not exists yolo_image_name text;
alter table public.inspections add column if not exists yolo_detections jsonb;
alter table public.inspections add column if not exists yolo_confidence numeric(6,2);
alter table public.inspections add column if not exists yolo_risk_level text;
create index if not exists idx_inspections_yolo_risk on public.inspections(yolo_risk_level);
