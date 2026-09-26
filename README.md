# Mu'allim · المعلم

AI fault diagnosis for maintenance teams, built on each company's own repair history.
Product brief: `Muallim - Product Brief and MVP Plan.pdf`.

## Repository layout

| Path | What it is |
|---|---|
| `mobile/` | Expo (React Native) app: technician, engineer and manager roles in one app, Arabic/English with RTL |
| `supabase/` | Database migrations, row-level security, Edge Functions (diagnosis, ingestion, AI layer) |
| `supabase/functions/_shared/ai/` | Provider-neutral AI layer: DeepInfra (OpenAI-compatible) or a deterministic mock |
| `data/generator/` | Scripts that generate the **sample** dataset (fictional compressors and plant) |
| `data/sample/` | Generated sample data: messy fault log (xlsx/csv), service manual PDF, machine list |
| `eval/` | Held-out test set and (from Phase 2) the evaluation script |

> All data in `data/sample` and `eval` is **invented** ("SampleAir AirCore RS-37 / RS-55", "Sahab Plant (SAMPLE)").
> `data/sample/reference/fault_catalog_clean.json` is ground truth for evaluation and is never imported into the app.

## Run the app

```bash
cd mobile
npm install
npx expo start          # scan the QR code with Expo Go on your phone
npx expo start --web    # or open in a browser
```

Backend settings go in `mobile/.env.local` (see `mobile/.env.example`).

## Checks

```bash
cd mobile && npx tsc --noEmit && npx expo lint
npx deno test supabase/functions/_shared --allow-env
```

## Regenerate the sample data

```bash
python -m venv .venv
.venv/Scripts/python -m pip install openpyxl reportlab
.venv/Scripts/python data/generator/generate.py
```

## AI provider

Set Edge Function secrets (see `supabase/functions/.env.example`). Without `DEEPINFRA_API_KEY`
everything runs on the mock provider. Model names are configuration; the test set decides the final choice.
