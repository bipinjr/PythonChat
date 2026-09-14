"""
api/index.py — Vercel serverless function entry point.

This file is what Vercel runs. The Python runtime natively supports Flask's
WSGI application interface, so the exported `app` is the serverless entry.

Project structure expected by Vercel:
    /
    ├── api/
    │   └── index.py       ← this file
    ├── nlp_engine.py
    ├── knowledge_base.json
    ├── static/
    │   ├── index.html
    │   ├── style.css
    │   └── app.js
    ├── requirements.txt
    └── vercel.json

The static files are served by Vercel's static hosting, and `api/index.py`
handles all /api/* requests.
"""

import sys
from pathlib import Path

project_root = str(Path(__file__).resolve().parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app import app
