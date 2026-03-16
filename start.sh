#!/bin/bash
set -e

# Find the backend directory
BACKEND_DIR=""
if [ -d "backend" ]; then
    BACKEND_DIR="$(pwd)/backend"
elif [ -d "mvp-process-mapper/backend" ]; then
    BACKEND_DIR="$(pwd)/mvp-process-mapper/backend"
elif [ -f "app.py" ]; then
    # Docker case: files are already in /app (current directory)
    BACKEND_DIR="$(pwd)"
else
    echo "Error: Could not find backend directory"
    echo "Current directory: $(pwd)"
    echo "Contents:"
    ls -la
    exit 1
fi

# Change to backend directory and start the application
cd "$BACKEND_DIR"
echo "Starting from directory: $(pwd)"
uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}

