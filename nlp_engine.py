"""
nlp_engine.py — Pure-Python TF-IDF + Cosine Similarity matcher.
No external ML libraries. No APIs. Real local NLP.

Features:
- TF-IDF vectorization built from scratch
- Cosine similarity scoring
- Synonym/keyword expansion so rephrased questions still match
- Stopword filtering
- Confidence thresholds
- Related-question lookup
- Admin: add / remove / save entries
"""

import json
import math
import os
import re
from collections import Counter, defaultdict
from typing import Optional


class TFIDFVectorizer:
    """TF-IDF vectorizer implemented from scratch.

    Pipeline:
        tokenize -> compute TF per doc -> compute IDF across corpus -> TF * IDF
    """

    # Reasonable English stopword list — covers the most common noise words.
    STOPWORDS: frozenset = frozenset([
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "need", "dare", "ought",
        "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "as", "into", "through", "during", "before", "after", "above", "below",
        "between", "out", "off", "over", "under", "again", "further", "then",
        "once", "here", "there", "when", "where", "why", "how", "all", "each",
        "every", "both", "few", "more", "most", "other", "some", "such", "no",
        "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just",
        "because", "until", "while", "about", "against", "up", "down", "if",
        "or", "and", "but", "also", "well", "back", "still", "already", "yet",
        "any", "anything", "everything", "nothing", "something", "now",
        "please", "help", "me", "my", "mine", "myself", "we", "our", "ours",
        "ourselves", "you", "your", "yours", "yourself", "yourselves",
        "he", "him", "his", "himself", "she", "her", "hers", "herself",
        "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
        "this", "that", "these", "those", "am", "get", "got", "go", "goes",
        "went", "come", "came", "make", "made", "take", "took", "see", "saw",
        "known", "know", "knew", "think", "thought", "want", "wanted", "like",
        "liked", "use", "used", "using", "find", "found", "give", "gave",
        "tell", "told", "ask", "asked", "need", "needed", "try", "tried",
        "leave", "call", "called", "let", "set", "put", "mean", "means",
        "become", "became", "begin", "began", "keep", "kept", "hold", "held",
        "write", "wrote", "written", "provide", "sit", "sat", "stand", "stood",
        "lose", "lost", "pay", "paid", "meet", "met", "include", "included",
        "continue", "changed", "change", "lead", "led", "understand", "seen",
        "watch", "watched", "follow", "followed", "stop", "stopped", "create",
        "created", "speak", "spoke", "read", "allow", "allowed", "add", "added",
        "spend", "spent", "grow", "grew", "open", "opened", "walk", "walked",
        "win", "won", "teach", "taught", "offer", "offered", "remember",
        "remember", "love", "loved", "appear", "appeared", "buy", "bought",
        "wait", "waited", "serve", "served", "die", "died", "send", "sent",
        "expect", "expected", "build", "built", "stay", "stayed", "fall", "fell",
        "fallen", "cut", "reach", "reached", "kill", "killed", "remain", "remained",
        "suggest", "suggested", "raise", "raised", "pass", "passed", "sell", "sold",
        "require", "required", "report", "reported", "decide", "decided", "pull",
        "pulled", "develop", "developed",
    ])

    def __init__(self) -> None:
        self.vocabulary: dict[str, int] = {}   # term -> index
        self.idf: dict[str, float] = {}        # term -> idf weight
        self._fitted = False

    # ------------------------------------------------------------------
    # Tokenization
    # ------------------------------------------------------------------

    def tokenize(self, text: str) -> list[str]:
        """Lowercase, strip punctuation, split, remove stopwords and short tokens."""
        text = text.lower()
        text = re.sub(r"[^a-z0-9\s]", " ", text)
        tokens = text.split()
        return [
            t for t in tokens
            if t not in self.STOPWORDS and len(t) > 1
        ]

    # ------------------------------------------------------------------
    # Fitting
    # ------------------------------------------------------------------

    def fit(self, documents: list[str]) -> "TFIDFVectorizer":
        """Learn vocabulary and IDF from a corpus of documents."""
        tokenized_docs = [self.tokenize(doc) for doc in documents]

        # Document frequency: how many docs contain each term
        df: Counter = Counter()
        for tokens in tokenized_docs:
            for term in set(tokens):
                df[term] += 1

        N = len(documents)

        # Vocabulary: every term that appeared in at least 1 doc
        self.vocabulary = {term: idx for idx, term in enumerate(sorted(df.keys()))}

        # IDF with smoothing: log((N + 1) / (df + 1)) + 1
        self.idf = {}
        for term, count in df.items():
            self.idf[term] = math.log((N + 1) / (count + 1)) + 1

        self._fitted = True
        return self

    # ------------------------------------------------------------------
    # Transformation
    # ------------------------------------------------------------------

    def transform(self, documents: list[str]) -> list[list[float]]:
        """Transform documents into TF-IDF vectors."""
        if isinstance(documents, str):
            documents = [documents]

        tokenized = [self.tokenize(doc) for doc in documents]
        vectors: list[list[float]] = []

        for tokens in tokenized:
            tf = Counter(tokens)
            max_tf = max(tf.values()) if tf else 1
            vec = [0.0] * len(self.vocabulary)

            for term, count in tf.items():
                if term in self.vocabulary:
                    idx = self.vocabulary[term]
                    # Augmented TF: 0.5 + 0.5 * (count / max_tf)
                    tf_norm = 0.5 + 0.5 * (count / max_tf)
                    vec[idx] = tf_norm * self.idf.get(term, 0.0)

            vectors.append(vec)

        return vectors

    def fit_transform(self, documents: list[str]) -> list[list[float]]:
        """Fit and transform in one step."""
        self.fit(documents)
        return self.transform(documents)


class CosineSimilarity:
    """Cosine similarity between sparse or dense vectors."""

    @staticmethod
    def score(vec_a: list[float], vec_b: list[float]) -> float:
        """Compute cosine similarity between two dense vectors."""
        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0
        for a, b in zip(vec_a, vec_b):
            dot += a * b
            norm_a += a * a
            norm_b += b * b
        denom = math.sqrt(norm_a) * math.sqrt(norm_b)
        if denom == 0.0:
            return 0.0
        return dot / denom

    @staticmethod
    def score_sparse(
        vec_a: dict[int, float],
        vec_b: dict[int, float],
    ) -> float:
        """Cosine similarity for sparse vectors represented as {index: weight}."""
        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0
        for idx, weight in vec_a.items():
            norm_a += weight * weight
            if idx in vec_b:
                dot += weight * vec_b[idx]
        for weight in vec_b.values():
            norm_b += weight * weight
        denom = math.sqrt(norm_a) * math.sqrt(norm_b)
        if denom == 0.0:
            return 0.0
        return dot / denom


class NLPEngine:
    """
    Main NLP engine. Load a knowledge base, build TF-IDF vectors, and
    match incoming queries by cosine similarity with synonym expansion.
    """

    def __init__(self, knowledge_base_path: Optional[str] = None) -> None:
        self.kb_path = knowledge_base_path or os.path.join(
            os.path.dirname(__file__), "knowledge_base.json"
        )
        self.entries: list[dict] = []
        self.vectorizer = TFIDFVectorizer()
        self.doc_vectors: list[list[float]] = []
        self.query_vectors: list[list[float]] = []  # expanded question vectors
        self._built = False

        # Precomputed related-question index: entry_index -> [related_entry_indices]
        self.related_index: dict[int, list[int]] = {}

        if os.path.exists(self.kb_path):
            self.load_kb()
            self.build()

    # ------------------------------------------------------------------
    # Knowledge base loading
    # ------------------------------------------------------------------

    def load_kb(self) -> None:
        """Load entries and synonyms from the JSON knowledge base."""
        if not os.path.exists(self.kb_path):
            raise FileNotFoundError(f"Knowledge base not found: {self.kb_path}")
        with open(self.kb_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.entries = data.get("entries", [])
        # Rebuild synonym map from the loaded data
        self.synonym_map: dict[str, set[str]] = {}
        raw_syns = data.get("synonyms", {})
        for canonical, alts in raw_syns.items():
            self.synonym_map[canonical.lower()] = {
                canonical.lower()
            } | {a.lower() for a in alts}

    # ------------------------------------------------------------------
    # Synonym expansion
    # ------------------------------------------------------------------

    def _expand_query(self, text: str) -> str:
        """
        Expand query text with synonyms. If any token in the query matches
        a synonym group, add the canonical form and all other synonyms.
        """
        tokens = re.findall(r"\b\w+\b", text.lower())
        expanded = set(tokens)
        for tok in tokens:
            for canonical, group in self.synonym_map.items():
                if tok in group:
                    expanded.update(group)
        # Return the original text plus expanded tokens as additional context
        return text + " " + " ".join(sorted(expanded - set(tokens)))

    # ------------------------------------------------------------------
    # Building the vector space
    # ------------------------------------------------------------------

    def build(self) -> None:
        """Build TF-IDF vectors for all entries and precompute related index."""
        if not self.entries:
            self._built = True
            return

        # Corpus: each entry's question + expanded version for better recall
        questions = [e["question"] for e in self.entries]
        expanded_questions = [self._expand_query(q) for q in questions]
        corpus = questions + expanded_questions

        self.vectorizer.fit(corpus)

        # Document vectors (original questions only)
        self.doc_vectors = self.vectorizer.transform(questions)

        # Query vectors (expanded questions) — used for related-question lookup
        self.query_vectors = self.vectorizer.transform(expanded_questions)

        # Precompute related-question index
        self._build_related_index()

        self._built = True

    def _build_related_index(self) -> None:
        """For each entry, find other entries with similar questions or same topic."""
        n = len(self.entries)
        for i in range(n):
            related = []
            entry = self.entries[i]
            topic = entry.get("topic", "general")
            for j in range(n):
                if i == j:
                    continue
                other = self.entries[j]
                score = 0.0
                # Same topic bonus
                if other.get("topic") == topic:
                    score += 0.25
                # Question similarity
                sim = CosineSimilarity.score(
                    self.query_vectors[i],
                    self.query_vectors[j],
                )
                score += sim * 0.75
                if score > 0.08:
                    related.append((j, round(score, 4)))
            related.sort(key=lambda x: x[1], reverse=True)
            self.related_index[i] = [idx for idx, _ in related[:5]]

    # ------------------------------------------------------------------
    # Matching
    # ------------------------------------------------------------------

    def match(
        self,
        query: str,
        top_n: int = 3,
        threshold: float = 0.12,
    ) -> list[dict]:
        """
        Match a query against the knowledge base.

        Returns a list of matched entries with confidence scores, sorted
        by relevance (highest first).

        Each result:
            {
                "entry":  <full entry dict>,
                "score":  float (0-1),
                "rank":   int,
            }
        """
        if not self._built:
            self.build()

        if not self.entries:
            return []

        expanded_query = self._expand_query(query)
        query_vec = self.vectorizer.transform([expanded_query])[0]

        scored: list[tuple[int, float]] = []
        normalized_query = " ".join(query.lower().split())
        for idx, doc_vec in enumerate(self.doc_vectors):
            sim = CosineSimilarity.score(query_vec, doc_vec)
            if normalized_query == " ".join(self.entries[idx]["question"].lower().split()):
                sim = 1.0
            scored.append((idx, sim))

        scored.sort(key=lambda x: x[1], reverse=True)

        results = []
        for rank, (idx, score) in enumerate(scored[:top_n], start=1):
            if score < threshold:
                break
            results.append({
                "entry": self.entries[idx],
                "score": round(score, 4),
                "rank": rank,
            })

        return results

    # ------------------------------------------------------------------
    # Related questions
    # ------------------------------------------------------------------

    def get_related(self, entry: dict, top_n: int = 3) -> list[dict]:
        """Return related questions for a given entry."""
        for idx, e in enumerate(self.entries):
            if e is entry:
                related_indices = self.related_index.get(idx, [])
                results = []
                for ri in related_indices[:top_n]:
                    results.append({
                        "entry": self.entries[ri],
                        "score": 0.0,  # relevance already encoded in index order
                    })
                return results
        return []

    # ------------------------------------------------------------------
    # Admin: add / remove / save
    # ------------------------------------------------------------------

    def add_entry(self, entry: dict) -> None:
        """Add a new entry and rebuild the vector space."""
        self.entries.append(entry)
        self._built = False
        self.build()

    def remove_entry(self, index: int) -> bool:
        """Remove an entry by index. Returns True if removed."""
        if 0 <= index < len(self.entries):
            self.entries.pop(index)
            self._built = False
            self.build()
            return True
        return False

    def save(self) -> None:
        """Persist the current knowledge base (entries + synonyms) to disk."""
        data = {
            "entries": self.entries,
            "synonyms": {
                canonical: list(group)
                for canonical, group in self.synonym_map.items()
            },
        }
        # Preserve the directory if it's an absolute path
        os.makedirs(os.path.dirname(self.kb_path) or ".", exist_ok=True)
        with open(self.kb_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        self._built = False
        self.build()
