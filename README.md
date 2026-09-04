# MOTUS DOT Scraper

Scrapes US federal carrier registration data from [MOTUS](https://motus.dot.gov/) and stores it locally and in Supabase.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Supabase credentials
```

## Run

```bash
python app.py
```

Open http://127.0.0.1:8000

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `SUPABASE_ANON_KEY` | Anon/publishable key |

## Supabase Schema

Apply `supabase/schema.sql` in the Supabase SQL editor before first run.

## Migrate Local Data to Supabase

```bash
python migrate_to_supabase.py
```

## Deployment

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Set environment variables in your hosting platform (Railway, Render, Fly.io, etc.). Do not commit `.env`.
