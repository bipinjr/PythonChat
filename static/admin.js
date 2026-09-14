/**
 * admin.js — Admin panel frontend logic.
 *
 * Handles:
 *   - Loading / displaying all KB entries in a table
 *   - Add-question modal (open, validate, submit, close)
 *   - Deleting entries (with confirmation)
 *   - Loading / displaying unmatched questions
 *   - Clearing unmatched log
 *   - Stats bar (entries, topics, unmatched count)
 *   - Tab switching (Questions / Unmatched)
 *   - Dark/light theme toggle (persisted)
 *   - Toast notifications
 *   - Row click → copy question to clipboard + "send to chat" behavior
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
    this.set(this.get() === "dark" ? "light" : "dark");
  },
};


/* ===================================================================
 * DOM refs
 * =================================================================== */

const dom = {
  themeBtn: document.getElementById("themeToggle"),
  statEntries: document.getElementById("statEntries"),
  statTopics: document.getElementById("statTopics"),
  statUnmatched: document.getElementById("statUnmatched"),
  questionsBody: document.getElementById("questionsBody"),
  questionsEmpty: document.getElementById("questionsEmpty"),
  questionsTable: document.getElementById("questionsTable"),
  unmatchedList: document.getElementById("unmatchedList"),
  unmatchedEmpty: document.getElementById("unmatchedEmpty"),
  unmatchedBadge: document.getElementById("unmatchedBadge"),
  tabQuestions: document.getElementById("tabQuestions"),
  tabUnmatched: document.getElementById("tabUnmatched"),
  tabBtns: document.querySelectorAll(".admin-tab"),
  addBtn: document.getElementById("addQuestionBtn"),
  clearBtn: document.getElementById("clearUnmatchedBtn"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalClose: document.getElementById("modalClose"),
  formCancel: document.getElementById("formCancel"),
  form: document.getElementById("addQuestionForm"),
  formSubmit: document.getElementById("formSubmit"),
  formQuestion: document.getElementById("formQuestion"),
  formAnswer: document.getElementById("formAnswer"),
  formTopic: document.getElementById("formTopic"),
  formDifficulty: document.getElementById("formDifficulty"),
  formCode: document.getElementById("formCode"),
  toastContainer: document.getElementById("toastContainer"),
  toolbarHint: document.querySelector(".toolbar-hint"),
};


/* ===================================================================
 * Toast system
 * =================================================================== */

function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  // Simple icon mapping
  const icon = type === "success"
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : type === "error"
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

  el.innerHTML = `${icon}<span>${escapeHTML(message)}</span>`;
  dom.toastContainer.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    setTimeout(() => el.remove(), 300);
  }, 3500);
}


/* ===================================================================
 * Utilities
 * =================================================================== */

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function show(el) { el.style.display = ""; }
function hide(el) { el.style.display = "none"; }

function setActiveTab(tabId) {
  dom.tabBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  [dom.tabQuestions, dom.tabUnmatched].forEach(el => {
    el.classList.toggle("active", el.id === `tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
  });
}

/**
 * Open the add-question modal, optionally pre-filling fields.
 */
function openModal(data = {}) {
  dom.modalOverlay.style.display = "flex";
  dom.formQuestion.focus();

  if (data.question) dom.formQuestion.value = data.question;
  if (data.answer) dom.formAnswer.value = data.answer;
  if (data.topic) dom.formTopic.value = data.topic;
  if (data.difficulty) dom.formDifficulty.value = data.difficulty;
  if (data.code) dom.formCode.value = data.code;

  dom.formSubmit.textContent = data.editId ? "Save Changes" : "Add Question";
  dom.formSubmit.dataset.editId = data.editId || "";
}


function closeModal() {
  dom.modalOverlay.style.display = "none";
  dom.form.reset();
  dom.formSubmit.dataset.editId = "";
}


/* ===================================================================
 * API helpers
 * =================================================================== */

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}


/* ===================================================================
 * Stats
 * =================================================================== */

async function loadStats() {
  try {
    const data = await apiFetch("/api/stats");
    dom.statEntries.textContent = data.kb_entries;
    dom.statTopics.textContent = data.kb_topics.length;
    dom.statUnmatched.textContent = data.unmatched_count;
  } catch (err) {
    console.error("Failed to load stats:", err);
    dom.statEntries.textContent = "--";
    dom.statTopics.textContent = "--";
    dom.statUnmatched.textContent = "--";
  }
}


/* ===================================================================
 * Questions table
 * =================================================================== */

async function loadQuestions() {
  try {
    const data = await apiFetch("/api/admin/questions");
    const entries = data.entries || [];

    if (entries.length === 0) {
      hide(dom.questionsBody);
      show(dom.questionsEmpty);
      return;
    }

    hide(dom.questionsEmpty);
    show(dom.questionsBody);
    dom.questionsBody.innerHTML = "";

    entries.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.id = entry.id;
      tr.dataset.index = idx;

      const topicLabel = entry.topic || "general";
      const diffLabel = entry.difficulty || "intermediate";
      const codePreview = entry.code
        ? entry.code.replace(/\n/g, " ↵ ").substring(0, 60) + (entry.code.length > 60 ? "…" : "")
        : "";

      tr.innerHTML = `
        <td class="col-id"><span class="row-id">${entry.id}</span></td>
        <td class="col-question">
          <div class="question-cell">
            <span class="question-text">${escapeHTML(entry.question)}</span>
            ${codePreview ? `<span class="code-indicator" title="${escapeHTML(entry.code)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              has code
            </span>` : ""}
          </div>
        </td>
        <td class="col-topic">
          <span class="chip chip-topic" style="font-size:0.7rem;padding:2px 6px;">${escapeHTML(topicLabel)}</span>
        </td>
        <td class="col-difficulty">
          <span class="chip chip-difficulty ${diffLabel}" style="font-size:0.7rem;padding:2px 6px;">${diffLabel.charAt(0).toUpperCase() + diffLabel.slice(1)}</span>
        </td>
        <td class="col-actions">
          <button class="row-btn row-edit" data-id="${entry.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="row-btn row-delete" data-id="${entry.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </td>
      `;

      // Row click → copy question text (and optionally open in new tab chat)
      tr.addEventListener("click", (e) => {
        // Don't trigger if the click was on a button
        if (e.target.closest("button")) return;
        const question = entry.question;
        navigator.clipboard.writeText(question).then(() => {
          toast(`Copied: "${question.substring(0, 40)}${question.length > 40 ? "…" : ""}"`, "info");
        }).catch(() => {
          // Fallback: select the text in the cell
          const cell = tr.querySelector(".question-text");
          const range = document.createRange();
          range.selectNodeContents(cell);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          toast("Question selected — copy manually (Ctrl+C)", "info");
        });
      });

      dom.questionsBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load questions:", err);
    toast(err.message, "error");
  }
}


/* ===================================================================
 * Add / Edit question
 * =================================================================== */

dom.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const question = dom.formQuestion.value.trim();
  const answer = dom.formAnswer.value.trim();
  if (!question || !answer) {
    toast("Both question and answer are required.", "error");
    return;
  }

  const editId = dom.formSubmit.dataset.editId || "";
  const payload = {
    question,
    answer,
    topic: dom.formTopic.value,
    difficulty: dom.formDifficulty.value,
    code: dom.formCode.value.trim(),
  };

  try {
    if (editId) {
      // For edit, we delete + re-add (simplest approach with current API)
      await apiFetch(`/api/admin/questions/${editId}`, { method: "DELETE" });
    }

    const result = await apiFetch("/api/admin/questions", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    closeModal();
    await loadQuestions();
    await loadStats();
    await loadUnmatched();

    toast(
      editId
        ? `Updated question #${editId}`
        : `Added question #${result.id}`,
      "success"
    );
  } catch (err) {
    console.error("Failed to save question:", err);
    toast(err.message, "error");
  }
});


// Edit button handlers (delegated)
dom.questionsBody.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".row-edit");
  if (!editBtn) return;
  e.stopPropagation();

  const id = parseInt(editBtn.dataset.id, 10);
  try {
    const data = await apiFetch("/api/admin/questions");
    const entry = data.entries.find(e => e.id === id);
    if (entry) {
      openModal({
        editId: id,
        question: entry.question,
        answer: entry.answer,
        topic: entry.topic,
        difficulty: entry.difficulty,
        code: entry.code || "",
      });
    }
  } catch (err) {
    toast(err.message, "error");
  }
});


// Delete button handlers (delegated)
dom.questionsBody.addEventListener("click", async (e) => {
  const deleteBtn = e.target.closest(".row-delete");
  if (!deleteBtn) return;
  e.stopPropagation();

  const id = parseInt(deleteBtn.dataset.id, 10);
  const entry = dom.questionsBody.querySelector(`tr[data-id="${id}"]`);
  const questionText = entry?.querySelector(".question-text")?.textContent || "";

  if (!confirm(`Delete question #${id}?\n\n"${questionText.substring(0, 80)}${questionText.length > 80 ? "…" : ""}"\n\nThis cannot be undone.`)) {
    return;
  }

  try {
    await apiFetch(`/api/admin/questions/${id}`, { method: "DELETE" });
    await loadQuestions();
    await loadStats();
    toast(`Deleted question #${id}`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
});


/* ===================================================================
 * Unmatched questions
 * =================================================================== */

async function loadUnmatched() {
  try {
    const data = await apiFetch("/api/admin/unsaved");
    const items = data.unmatched || [];

    dom.unmatchedBadge.textContent = items.length;

    if (items.length === 0) {
      hide(dom.unmatchedList);
      show(dom.unmatchedEmpty);
      return;
    }

    hide(dom.unmatchedEmpty);
    show(dom.unmatchedList);
    dom.unmatchedList.innerHTML = "";

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "unmatched-card";
      card.innerHTML = `
        <div class="unmatched-header">
          <span class="unmatched-score">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Best match: ${(item.top_score * 100).toFixed(0)}%
          </span>
          <span class="unmatched-time">${formatTime(item.timestamp)}</span>
        </div>
        <div class="unmatched-question">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="q-text">${escapeHTML(item.question)}</span>
        </div>
        <div class="unmatched-actions">
          <button class="btn-sm btn-primary" data-question="${escapeHTML(item.question)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            Ask bot
          </button>
          <button class="btn-sm btn-secondary" data-question="${escapeHTML(item.question)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Add to KB
          </button>
        </div>
      `;
      dom.unmatchedList.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load unmatched:", err);
    toast(err.message, "error");
  }
}


// Unmatched button handlers (delegated)
dom.unmatchedList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const question = btn.dataset.question;

  if (btn.classList.contains("btn-primary")) {
    // "Ask bot" — redirect to chat with the question prefilled
    // We open the chat in a new tab with the question in the URL fragment
    // (The chat page reads ?question= from URL if we want; for now, open and let user paste)
    window.open("/", "_blank");
    toast("Chat opened in new tab — paste the question", "info");
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(question).then(() => {
      toast("Question copied — paste it in the chat", "info");
    }).catch(() => {});
  } else if (btn.classList.contains("btn-secondary")) {
    // "Add to KB" — open the add modal pre-filled
    openModal({ question });
    dom.formQuestion.focus();
    toast("Pre-filled the question — add an answer and save", "info");
  }
});


async function clearUnmatched() {
  if (!confirm("Clear all unmatched questions log?")) return;

  try {
    await apiFetch("/api/admin/unsaved", { method: "DELETE" });
    await loadUnmatched();
    await loadStats();
    toast("Unmatched log cleared", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}


/* ===================================================================
 * Tab switching
 * =================================================================== */

dom.tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    setActiveTab(tab);
    if (tab === "questions") {
      loadQuestions();
    } else {
      loadUnmatched();
    }
  });
});


/* ===================================================================
 * Modal controls
 * =================================================================== */

dom.addBtn.addEventListener("click", () => openModal());
dom.modalClose.addEventListener("click", closeModal);
dom.formCancel.addEventListener("click", closeModal);
dom.modalOverlay.addEventListener("click", (e) => {
  if (e.target === dom.modalOverlay) closeModal();
});

// Close modal on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dom.modalOverlay.style.display === "flex") {
    closeModal();
  }
});


/* ===================================================================
 * Clear unmatched
 * =================================================================== */

dom.clearBtn.addEventListener("click", clearUnmatched);


/* ===================================================================
 * Theme toggle
 * =================================================================== */

dom.themeBtn.addEventListener("click", () => {
  Theme.toggle();
});


/* ===================================================================
 * Refresh data periodically (every 30s)
 * =================================================================== */

setInterval(() => {
  loadStats();
  if (dom.tabQuestions.classList.contains("active")) {
    loadQuestions();
  } else if (dom.tabUnmatched.classList.contains("active")) {
    loadUnmatched();
  }
}, 30000);


/* ===================================================================
 * Init
 * =================================================================== */

function init() {
  Theme.init();

  // Set active tab based on URL hash or default
  const hash = window.location.hash.slice(1);
  if (hash === "unmatched") {
    setActiveTab("unmatched");
  } else {
    setActiveTab("questions");
  }

  // Load data for the active tab
  if (dom.tabQuestions.classList.contains("active")) {
    loadQuestions();
  } else {
    loadUnmatched();
  }

  loadStats();

  // Re-load when tab becomes visible again (in case user switches away and back)
  const observer = new MutationObserver(() => {
    if (dom.tabQuestions.classList.contains("active")) {
      loadQuestions();
    }
  });
  observer.observe(dom.tabQuestions, { attributes: true, attributeFilter: ["class"] });
}

document.addEventListener("DOMContentLoaded", init);
