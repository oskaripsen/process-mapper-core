# Process Mapper Core

Process Mapper Core is an open-source workflow and process-mapping engine.
It converts spoken or written process descriptions into editable process flows,
supports SOP generation workflows, and provides a React-based visual editor.

## Quick Start

### Backend

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Backend runs on `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Tech Stack

- Backend: FastAPI, Python
- Frontend: React, Vite, React Flow
- AI: LLM-assisted process extraction and transcription pipeline

## Project Structure

```text
process-mapper-core/
  backend/
  frontend/
  Dockerfile
```

## Legal & IP

This project is an independent, open-source core engine developed by Oskar Ipsen.
This repository contains the foundational logic only.
Any specific enterprise implementations, private configurations, or proprietary
business logic developed for external entities are separate, private, and not
included in this public license.

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
