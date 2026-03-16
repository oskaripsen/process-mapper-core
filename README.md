# Process Mapper Core

Process Mapper Core is an open-source workflow and process-mapping engine.
It converts spoken or written process descriptions into editable process flows,
supports SOP generation workflows, and provides a React-based visual editor.

## Quick Start

### 1. Set up the Whisper model (local transcription)

The app uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for
local audio transcription. Model files are too large for Git, so you need to
add them manually.

Create the following folder structure in the project root:

```
models/
  faster-whisper-small/
    config.json
    model.bin
    tokenizer.json
    vocabulary.txt
```

**To get these files**, download the `small` model from HuggingFace:

```bash
pip install faster-whisper
python -c "from faster_whisper import WhisperModel; WhisperModel('small', compute_type='int8')"
```

This caches the model at `~/.cache/huggingface/hub/models--Systran--faster-whisper-small/`.
Copy the four files from the snapshot folder into `models/faster-whisper-small/`:

```bash
mkdir -p models/faster-whisper-small
cp ~/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots/*/config.json models/faster-whisper-small/
cp ~/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots/*/model.bin models/faster-whisper-small/
cp ~/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots/*/tokenizer.json models/faster-whisper-small/
cp ~/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots/*/vocabulary.txt models/faster-whisper-small/
```

> If the `models/` folder is missing, the app falls back to downloading the
> model from HuggingFace on first run (requires internet).

### 2. Backend

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # then edit .env with your keys
python app.py
```

Backend runs on `http://localhost:8000`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Switching SQLite to PostgreSQL

The current backend uses SQLite via `aiosqlite` in `backend/db.py`.  
To switch to PostgreSQL, use this migration path:

1. Add a PostgreSQL driver to `backend/requirements.txt` (recommended: `asyncpg`).
2. Replace the SQLite connection logic in `backend/db.py`:
   - remove `sqlite3` / `aiosqlite`
   - connect using `DATABASE_URL` (for example: `postgresql://user:pass@host:5432/dbname`)
   - return dict-like rows from Postgres queries (equivalent to `sqlite3.Row`)
3. Update `backend/.env` and `.env.example`:
   - keep `DATABASE_PATH` for local SQLite if desired, or
   - add `DATABASE_URL` for PostgreSQL and prefer it when present.
4. Review SQL compatibility in `backend/schema.sql` and query usage:
   - replace SQLite-specific syntax (`AUTOINCREMENT`, `PRAGMA`, etc.)
   - update parameter placeholders if needed (`?` vs `$1`, `$2`, ...)
   - verify datetime/default expressions and upsert patterns.
5. Recreate the schema in PostgreSQL, then run the app and validate:
   - login/auth
   - taxonomy CRUD
   - process flow save/load/versioning
   - exports and SOP generation.

Tip: a clean approach is to support both engines during transition:
- if `DATABASE_URL` exists, use PostgreSQL
- otherwise fallback to current SQLite behavior.

## Tech Stack

- Backend: FastAPI, Python
- Frontend: React, Vite, React Flow
- Transcription: faster-whisper (local, no API calls)
- AI: LLM-assisted process extraction and SOP generation

## Project Structure

```text
process-mapper-core/
  backend/       # FastAPI server
  frontend/      # React + Vite app
  models/        # faster-whisper model files (not in git)
```

## Legal & IP

This project is an independent, open-source core engine developed by Oskar Ipsen.
This repository contains the foundational logic only.
Any specific enterprise implementations, private configurations, or proprietary
business logic developed for external entities are separate, private, and not
included in this public license.

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
