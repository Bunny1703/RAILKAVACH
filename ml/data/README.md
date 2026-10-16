# ML dataset format

Use one row per inspection. Recommended columns:

```text
asset_age_years
wear_level
corrosion_level
crack_level
deformation_level
vibration_level
temperature_c
maintenance_count
previous_failures
days_since_last_inspection
risk_level
```

Numeric levels should use a consistent scale, for example 0-5. `risk_level` is the target label: LOW, MEDIUM, HIGH, or CRITICAL.

For a final-year project, keep the dataset provenance documented. If synthetic rows are used for a demo, label them synthetic and do not present their accuracy as field performance.
