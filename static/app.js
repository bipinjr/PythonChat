/**
 * app.js — Main chat UI logic.
 *
 * Handles:
 *   - Sending questions to /api/chat
 *   - Rendering bot answers with code blocks, chips, related questions
 *   - Rendering unmatched "I don't know" messages
 *   - Dark/light theme toggle (persisted in localStorage)
 *   - Auto-resizing textarea
 *   - Suggestion chips
 *   - Welcome overlay dismissal
 */

/* ===================================================================
 * Theme
 * =================================================================== */

const Theme = {
  get() {
    return localStorage.getItem("pyqa-theme") || "dark";
  },

  set(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pyqa-theme", theme);
  },

  init() {
    this.set(this.get());
  },

  toggle() {
    const current = this.get();
    this.set(current === "dark" ? "light" : "dark");
  },
};


/* ===================================================================
 * DOM refs
 * =================================================================== */

const dom = {
  messages: document.getElementById("messages"),
  form: document.getElementById("chatForm"),
  input: document.getElementById("questionInput"),
  sendBtn: document.getElementById("sendBtn"),
  typing: document.getElementById("typingIndicator"),
  welcome: document.getElementById("welcomeOverlay"),
  themeBtn: document.getElementById("themeToggle"),
};


/* ===================================================================
 * Utilities
 * =================================================================== */

function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Light syntax highlighting for Python code blocks.
 * Wraps keywords, strings, comments, numbers, builtins in styled spans.
 */
function highlightPython(code) {
  if (!code || code.trim() === "") return "";

  // Keywords
  const keywords = [
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
    "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
    "raise", "return", "try", "while", "with", "yield", "True", "False", "None",
  ];
  // Built-in functions (common ones)
  const builtins = [
    "print", "len", "range", "int", "float", "str", "list", "dict", "set",
    "tuple", "type", "isinstance", "open", "super", "len", "input", "abs",
    "all", "any", "bin", "bool", "bytearray", "bytes", "callable", "chr",
    "classmethod", "compile", "complex", "delattr", "dir", "divmod", "enumerate",
    "eval", "exec", "filter", "float", "format", "frozenset", "getattr", "globals",
    "hasattr", "hash", "help", "hex", "id", "input", "int", "isinstance",
    "issubclass", "iter", "len", "list", "locals", "map", "max", "memoryview",
    "min", "next", "object", "oct", "open", "ord", "pow", "print", "property",
    "range", "repr", "reversed", "round", "set", "setattr", "slice", "sorted",
    "staticmethod", "str", "sum", "super", "tuple", "type", "vars", "zip",
    "ImportError", "ValueError", "TypeError", "KeyError", "IndexError",
    "AttributeError", "NameError", "SyntaxError", "IndentationError",
    "ZeroDivisionError", "StopIteration", "Exception",
  ];
  const keywordSet = new Set(keywords);
  const builtinSet = new Set(builtins);
  const tokenPattern = /#.*|(?:[rubfRUBF]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|[=+\-*/%<>!&|^~]+/g;
  let output = "";
  let lastIndex = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0];
    output += escapeHTML(code.slice(lastIndex, match.index));
    let className = "";
    if (token.startsWith("#")) className = "cm";
    else if (/^[rubfRUBF]*(?:["'])/.test(token)) className = "str";
    else if (/^\d/.test(token)) className = "num";
    else if (keywordSet.has(token)) className = "kw";
    else if (builtinSet.has(token)) className = "bi";
    else if (/^[=+\-*/%<>!&|^~]+$/.test(token)) className = "op";
    output += className
      ? `<span class="${className}">${escapeHTML(token)}</span>`
      : escapeHTML(token);
    lastIndex = match.index + token.length;
  }

  return output + escapeHTML(code.slice(lastIndex));
}

/**
 * Render a code block with optional syntax highlighting.
 */
function renderCode(code, language = "python") {
  if (!code || code.trim() === "") return "";

  const highlighted = highlightPython(code);

  return `
    <div class="message-code">
      <div class="message-code-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
          <polyline points="16 18 22 12 16 6"/>
          <polyline points="8 6 2 12 8 18"/>
        </svg>
        Code Example
        <button class="copy-code-btn" type="button" aria-label="Copy code">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="code-block">
        ${highlighted.split("\n").map((line, i) =>
          `<span class="code-line">${line || " "}</span>`
        ).join("")}
      </div>
    </div>
  `;
}

/**
 * Render topic & difficulty chips.
 */
function renderMeta(entry) {
  const topic = entry.topic || "general";
  const difficulty = entry.difficulty || "intermediate";
  const confidence = entry.confidence != null ? entry.confidence : null;

  return `
    <div class="message-meta">
      <span class="chip chip-topic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        ${escapeHTML(topic)}
      </span>
      <span class="chip chip-difficulty ${difficulty}">
        ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
      </span>
      ${confidence != null ? `<span class="chip chip-confidence">${Math.round(confidence * 100)}% match</span>` : ""}
    </div>
  `;
}

/**
 * Render related questions as clickable chips.
 */
function renderRelated(related) {
  if (!related || related.length === 0) return "";

  return `
    <div class="related-section">
      <div class="related-label">Related Questions</div>
      <div class="related-chips">
        ${related.map(r => `
          <button class="related-chip" data-question="${escapeHTML(r.question)}">
            ${escapeHTML(r.question)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

/**
 * Build a bot message DOM element from an answer entry.
 */
function buildBotMessage(entry, index) {
  const div = document.createElement("div");
  div.className = "message-bot";
  div.dataset.index = index;

  const relatedHTML = renderRelated(entry.related);

  div.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <span class="message-label">Python</span>
    </div>
    <div class="message-body">
      <div class="message-question">
        <span class="q-text">${escapeHTML(entry.question)}</span>
        <span class="q-badge">${entry.rank}. match · ${Math.round(entry.confidence * 100)}%</span>
      </div>
      <div class="message-answer">${escapeHTML(entry.answer)}</div>
      ${renderCode(entry.code)}
      ${renderMeta(entry)}
      ${relatedHTML}
    </div>
  `;

  const copyButton = div.querySelector(".copy-code-btn");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(entry.code || "");
      copyButton.classList.add("copied");
      copyButton.querySelector("span").textContent = "Copied";
      setTimeout(() => {
        copyButton.classList.remove("copied");
        copyButton.querySelector("span").textContent = "Copy";
      }, 1600);
    });
  }

  // Attach related-chip listeners
  div.querySelectorAll(".related-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      dom.input.value = btn.dataset.question;
      dom.input.focus();
      dom.input.dispatchEvent(new Event("input"));
    });
  });

  return div;
}

/**
 * Build an unmatched message DOM element.
 */
function buildUnmatchedMessage(question) {
  const div = document.createElement("div");
  div.className = "message-unmatched";
  div.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      </div>
      <span class="message-label">Python</span>
    </div>
    <div class="message-body">
      <div class="unmatched-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      </div>
      <div class="unmatched-text">
        <strong>I'm not sure about that one yet.</strong><br>
        I couldn't find a good answer for:<br>
        <span class="highlight">"${escapeHTML(question)}"</span>
      </div>
      <div class="unmatched-hint">
        You can add this question to my knowledge base from the Admin panel.
      </div>
    </div>
  `;
  return div;
}

/**
 * Add a user message bubble.
 */
function addUserMessage(question) {
  const div = document.createElement("div");
  div.className = "message-user";
  div.style.cssText = `
    display: flex;
    justify-content: flex-end;
    max-width: 100%;
    animation: messageIn 0.35s ease;
  `;

  const bubble = document.createElement("div");
  bubble.style.cssText = `
    background: var(--color-brand-soft);
    border: 1px solid rgba(255, 166, 87, 0.2);
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
    padding: var(--space-3) var(--space-4);
    max-width: 80%;
    word-break: break-word;
  `;
  bubble.textContent = question;

  div.appendChild(bubble);
  dom.messages.appendChild(div);
}


/* ===================================================================
 * API call
 * =================================================================== */

async function askQuestion(question) {
  addUserMessage(question);

  // Hide welcome overlay on first question
  if (dom.welcome) dom.welcome.style.display = "none";

  // Show typing indicator
  dom.typing.style.display = "flex";
  dom.sendBtn.disabled = true;
  dom.sendBtn.classList.add("loading");
  scrollToBottom();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        top_n: 3,
        threshold: 0.12,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Request failed");
    }

    const data = await res.json();
    renderResponse(data);
  } catch (err) {
    console.error("Chat error:", err);
    // Show error message in chat
    const errDiv = document.createElement("div");
    errDiv.className = "message-bot";
    errDiv.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <span class="message-label">Error</span>
      </div>
      <div class="message-body" style="background: rgba(248,81,73,0.06); border-color: rgba(248,81,73,0.2);">
        <div class="unmatched-text">Something went wrong: ${escapeHTML(err.message)}</div>
      </div>
    `;
    dom.messages.appendChild(errDiv);
  } finally {
    dom.typing.style.display = "none";
    dom.sendBtn.disabled = false;
    dom.sendBtn.classList.remove("loading");
    scrollToBottom();
  }
}

/**
 * Render the API response (answers or unmatched).
 */
function renderResponse(data) {
  if (data.answer && data.answer.length > 0) {
    data.answer.forEach((entry, i) => {
      const el = buildBotMessage(entry, i);
      dom.messages.appendChild(el);
    });
  } else if (data.unmatched) {
    const el = buildUnmatchedMessage(data.query);
    dom.messages.appendChild(el);
  }
}


/* ===================================================================
 * Event handlers
 * =================================================================== */

dom.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = dom.input.value.trim();
  if (!question) return;
  askQuestion(question);
  dom.input.value = "";
  dom.input.style.height = "auto";
});


// Auto-resize textarea
dom.input.addEventListener("input", () => {
  dom.input.style.height = "auto";
  dom.input.style.height = Math.min(dom.input.scrollHeight, 120) + "px";
});


// Enter to send (Shift+Enter for newline)
dom.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    dom.form.requestSubmit();
  }
});


// Theme toggle
dom.themeBtn.addEventListener("click", () => {
  Theme.toggle();
});


// Suggestion chips
document.querySelectorAll(".suggestion-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const q = chip.dataset.question;
    if (q) {
      dom.input.value = q;
      dom.input.focus();
      dom.input.dispatchEvent(new Event("input"));
      dom.form.requestSubmit();
    }
  });
});


// Click on the welcome overlay background doesn't dismiss it,
// but clicking a suggestion does the job.


/* ===================================================================
 * Init
 * =================================================================== */

Theme.init();
scrollToBottom();
