# Python Q&A Chatbot

A personal chatbot that answers Python programming questions. Built with a custom TF-IDF + cosine similarity NLP engine — no APIs, no external ML libraries, works fully offline.   The Deployed Link = https://python-chatbot-hehe-me3ntwe0k-bipinjrs-projects.vercel.app/

## What it does

- Accepts a natural-language Python question
- Matches it against a knowledge base of 50 Python Q&A entries using TF-IDF + cosine similarity
- Returns ranked answers with confidence scores, code examples, topic/difficulty tags, and related question suggestions
- Logs unmatched questions for review
- Provides an admin panel to add/edit/delete entries

## Project structure

```
python-chatbot/
├── app.py                  # Flask backend
├── nlp_engine.py           # Custom TF-IDF + cosine similarity NLP engine
├── knowledge_base.json     # 50 Python Q&A entries + synonym map
├── requirements.txt        # Python deps (Flask)
├── vercel.json             # Vercel routing config
├── .gitignore
├── README.md
├── api/
│   └── index.py            # Vercel serverless entry point
└── static/
    ├── index.html          # Chat UI
    ├── admin.html          # Admin panel UI
    ├── style.css           # Design system (dark + light themes)
    ├── app.js              # Chat frontend logic
    └── admin.js            # Admin panel frontend logic
```

## Local setup

```bash
# 1. Create a virtual environment
python -m venv venv
source venv/bin/activate       # macOS/Linux
venv\Scripts\activate          # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
python app.py
```

Open **http://127.0.0.1:5000** for the chat, **http://127.0.0.1:5000/admin** for the admin panel.

## API

### `POST /api/chat`

Ask a question.

```json
// Request
{ "question": "How do I reverse a list?", "top_n": 3, "threshold": 0.12 }

// Response
{
  "query": "How do I reverse a list?",
  "answer": [
    {
      "id": 5,
      "question": "How do I create and use a list in Python?",
      "answer": "...",
      "topic": "data-structures",
      "difficulty": "beginner",
      "code": "# ...",
      "confidence": 0.8742,
      "rank": 1,
      "related": [{ "question": "...", "id": 6 }]
    }
  ],
  "unmatched": false,
  "threshold_used": 0.12
}
```

### `GET /api/stats`

Knowledge base stats: entry count, topic list, unmatched count.

### `GET /api/admin/questions`

List all KB entries.

### `POST /api/admin/questions`

Add a new entry. Requires `question` and `answer`.

### `DELETE /api/admin/questions/<id>`

Remove an entry.

### `GET /api/admin/unsaved`

Unmatched questions log.

### `DELETE /api/admin/unsaved`

Clear the unmatched log.

### `GET /api/health`

Health check.

## NLP engine

The `nlp_engine.py` module implements:

1. **Tokenization** — lowercase, strip punctuation, split, remove stopwords
2. **Synonym expansion** — each token is checked against a synonym map; matching synonyms are added to the query
3. **TF-IDF vectorization** — built from scratch over the corpus of all question texts
4. **Cosine similarity** — query vector compared to every document vector; top-N above threshold returned
5. **Related questions** — precomputed index based on topic + question similarity

No scikit-learn, no NumPy, no external ML libraries. Pure Python.

## Knowledge base format

```json
{
  "entries": [
    {
      "id": 1,
      "question": "What is Python?",
      "answer": "A clear answer...",
      "topic": "basics",
      "difficulty": "beginner",
      "code": "optional code example",
      "related": [2, 3]
    }
  ],
  "synonyms": {
    "list": ["lists", "array", "arrays", "collection"]
  }
}
```

Edit `knowledge_base.json` directly or use the `/admin` panel.

## Deploying to Vercel

1. Push to GitHub
2. Import the repo in Vercel
3. Vercel reads `vercel.json` automatically — no extra config
4. Deploy

The `api/index.py` wraps the Flask app as a Vercel serverless function. `vercel.json` routes `/api/*` to it and serves static files from `/static/`.

## Requirements

- Python 3.8+
- Flask 3.x

Everything else (NLP, JSON, logging) uses the Python standard library.

## License

MIT
