"""
app.py — Flask backend for the Python Q&A Chatbot.

Endpoints:
  POST /api/chat            → ask a question, get matched answers
  GET  /api/stats           → usage statistics
  GET  /api/admin/questions → list all KB entries
  POST /api/admin/questions → add a new entry
  DELETE /api/admin/questions/<id> → remove an entry
  GET  /api/knowledge-base  → download the raw KB JSON
  GET  /                      → serve the chat UI
"""

import json
import logging
import os
import sys

from flask import Flask, Response, jsonify, request, send_from_directory

# ---------------------------------------------------------------------------
# Paths — resolved relative to THIS file so it works regardless of CWD.
# This matters for Vercel serverless where CWD != project root.
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.environ.get("PROJECT_ROOT", HERE)

KB_PATH = os.path.join(PROJECT_ROOT, "knowledge_base.json")
UNMATCHED_LOG_PATH = os.path.join(PROJECT_ROOT, "unmatched_log.json")

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(
    __name__,
    static_folder=os.path.join(PROJECT_ROOT, "static"),
    static_url_path="/static",
)

app.config["JSON_SORT_KEYS"] = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pyqa")
READ_ONLY_DEPLOYMENT = bool(os.environ.get("VERCEL"))


# ---------------------------------------------------------------------------
# NLP engine (singleton)
# ---------------------------------------------------------------------------

from nlp_engine import NLPEngine

nlp = NLPEngine(knowledge_base_path=KB_PATH)
logger.info("Loaded knowledge base: %d entries from %s", len(nlp.entries), KB_PATH)


# ---------------------------------------------------------------------------
# Unmatched-question log helpers
# ---------------------------------------------------------------------------

def _load_unmatched_log() -> list[dict]:
    if not os.path.exists(UNMATCHED_LOG_PATH):
        return []
    try:
        with open(UNMATCHED_LOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _append_unmatched(question: str, top_score: float) -> None:
    if READ_ONLY_DEPLOYMENT:
        logger.info("Skipping unmatched-question persistence in read-only deployment")
        return

    log = _load_unmatched_log()
    log.append({
        "question": question,
        "top_score": round(top_score, 4),
        "timestamp": __import__("datetime").datetime.now().isoformat(),
    })
    log = log[-200:]  # keep last 200
    tmp = UNMATCHED_LOG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)
    os.replace(tmp, UNMATCHED_LOG_PATH)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request", "message": str(e)}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(e):
    logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500


# ---------------------------------------------------------------------------
# Frontend routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the main chat UI."""
    return send_from_directory(app.static_folder, "index.html")


@app.route("/admin")
def admin_page():
    """Serve the admin panel UI."""
    return send_from_directory(app.static_folder, "admin.html")


@app.route("/<path:path>")
def serve_static(path):
    """Serve any other static file (CSS, JS, images, etc.)."""
    return send_from_directory(app.static_folder, path)


# ---------------------------------------------------------------------------
# Chat API
# ---------------------------------------------------------------------------

@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Ask a Python question. Returns ranked answers from the knowledge base.

    Request body (JSON):
        {
            "question": "str",       # required
            "top_n": 3,              # optional, default 3
            "threshold": 0.12,       # optional, default 0.12
        }

    Response (JSON):
        {
            "query": "str",
            "answer": [ {entry...}, ... ],
            "unmatched": bool,
            "threshold_used": float,
        }
    """
    data = request.get_json(silent=True)
    if not data or "question" not in data:
        return jsonify({"error": "Missing 'question' field"}), 400

    question = (data.get("question") or "").strip()
    if not question:
        return jsonify({"error": "Question cannot be empty"}), 400

    top_n = int(data.get("top_n", 3))
    threshold = float(data.get("threshold", 0.12))

    # Sanity-clamp
    top_n = max(1, min(top_n, 10))
    threshold = max(0.0, min(threshold, 1.0))

    results = nlp.match(question, top_n=top_n, threshold=threshold)
    unmatched = len(results) == 0

    if unmatched:
        top_score = results[0]["score"] if results else 0.0
        _append_unmatched(question, top_score)

    answers = []
    for r in results:
        e = r["entry"]
        related = nlp.get_related(e, top_n=3)
        answers.append({
            "id": e.get("id"),
            "question": e["question"],
            "answer": e["answer"],
            "topic": e.get("topic", "general"),
            "difficulty": e.get("difficulty", "intermediate"),
            "code": e.get("code", ""),
            "confidence": r["score"],
            "rank": r["rank"],
            "related": [
                {"question": re["entry"]["question"], "id": re["entry"]["id"]}
                for re in related
            ],
        })

    return jsonify({
        "query": question,
        "answer": answers,
        "unmatched": unmatched,
        "threshold_used": threshold,
    })


# ---------------------------------------------------------------------------
# Stats API
# ---------------------------------------------------------------------------

@app.route("/api/stats", methods=["GET"])
def stats():
    log = _load_unmatched_log()
    return jsonify({
        "kb_entries": len(nlp.entries),
        "unmatched_count": len(log),
        "kb_topics": sorted({e.get("topic", "general") for e in nlp.entries}),
    })


# ---------------------------------------------------------------------------
# Admin: questions CRUD
# ---------------------------------------------------------------------------

@app.route("/api/admin/questions", methods=["GET"])
def admin_list_questions():
    items = []
    for e in nlp.entries:
        items.append({
            "id": e.get("id"),
            "question": e["question"],
            "topic": e.get("topic", "general"),
            "difficulty": e.get("difficulty", "intermediate"),
            "code": e.get("code", ""),
        })
    return jsonify({"entries": items, "count": len(items)})


@app.route("/api/admin/questions", methods=["POST"])
def admin_add_question():
    """
    Add a new entry. Requires 'question' and 'answer'. Optional: topic,
    difficulty, code.
    """
    if READ_ONLY_DEPLOYMENT:
        return jsonify({"error": "Admin changes are disabled on Vercel deployments"}), 503

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400

    question = (data.get("question") or "").strip()
    answer = (data.get("answer") or "").strip()
    if not question or not answer:
        return jsonify({"error": "Both 'question' and 'answer' are required"}), 400

    existing_ids = [e.get("id", 0) for e in nlp.entries]
    new_id = (max(existing_ids) + 1) if existing_ids else 1

    entry = {
        "id": new_id,
        "question": question,
        "answer": answer,
        "topic": (data.get("topic") or "general").strip().lower(),
        "difficulty": (data.get("difficulty") or "intermediate").strip().lower(),
        "code": (data.get("code") or "").strip(),
        "related": [],
    }

    nlp.add_entry(entry)
    nlp.save()
    logger.info("Admin added question id=%s: %s", new_id, question[:60])

    return jsonify({"status": "ok", "id": new_id}), 201


@app.route("/api/admin/questions/<int:entry_id>", methods=["DELETE"])
def admin_delete_question(entry_id):
    if READ_ONLY_DEPLOYMENT:
        return jsonify({"error": "Admin changes are disabled on Vercel deployments"}), 503

    idx = None
    for i, e in enumerate(nlp.entries):
        if e.get("id") == entry_id:
            idx = i
            break

    if idx is None:
        return jsonify({"error": f"Entry with id={entry_id} not found"}), 404

    entry = nlp.entries[idx]
    nlp.remove_entry(idx)
    nlp.save()
    logger.info("Admin deleted question id=%s: %s", entry_id, entry["question"][:60])

    return jsonify({"status": "ok", "id": entry_id})


# ---------------------------------------------------------------------------
# Admin: unmatched log
# ---------------------------------------------------------------------------

@app.route("/api/admin/unsaved", methods=["GET"])
def admin_unmatched():
    log = _load_unmatched_log()
    return jsonify({"unmatched": log, "count": len(log)})


@app.route("/api/admin/unsaved", methods=["DELETE"])
def admin_clear_unmatched():
    if READ_ONLY_DEPLOYMENT:
        return jsonify({"error": "Admin changes are disabled on Vercel deployments"}), 503

    if os.path.exists(UNMATCHED_LOG_PATH):
        os.remove(UNMATCHED_LOG_PATH)
    return jsonify({"status": "ok", "cleared": True})


# ---------------------------------------------------------------------------
# Knowledge base download (dev/admin convenience)
# ---------------------------------------------------------------------------

@app.route("/api/knowledge-base", methods=["GET"])
def download_kb():
    if not os.path.exists(KB_PATH):
        return jsonify({"error": "Knowledge base not found"}), 404
    return send_from_directory(PROJECT_ROOT, "knowledge_base.json")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "kb_entries": len(nlp.entries),
        "kb_path": KB_PATH,
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting Python Q&A Chatbot server on http://127.0.0.1:5000")
    logger.info("Knowledge base: %s (%d entries)", KB_PATH, len(nlp.entries))
    app.run(host="127.0.0.1", port=5000, debug=True)
