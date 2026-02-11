/**
 * Vocab Highlighter — Popup page logic.
 * Vocabulary list management: view, search, edit, delete, scan trigger.
 */

const searchInput = document.getElementById("searchInput");
const vocabListEl = document.getElementById("vocabList");
const footerEl = document.getElementById("footer");
const scanBtn = document.getElementById("scanBtn");
const settingsBtn = document.getElementById("settingsBtn");
const apiWarning = document.getElementById("apiWarning");
const apiWarningLink = document.getElementById("apiWarningLink");

/** Full vocab list cached locally. */
let vocabData = [];

// -----------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------

init();

async function init() {
  // Check API key
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    apiWarning.style.display = "block";
  }

  // Load vocab list
  vocabData = await chrome.runtime.sendMessage({
    type: "SCAN_PAGE",
    payload: {},
  });

  renderList(vocabData);
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------

/**
 * Render the vocabulary list, optionally filtered by search query.
 * @param {Array} list - Array of VocabEntry objects.
 */
function renderList(list) {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? list.filter(
        (e) =>
          e.word.toLowerCase().includes(query) ||
          e.translation.toLowerCase().includes(query)
      )
    : list;

  if (filtered.length === 0) {
    vocabListEl.innerHTML = `<div class="vocab-empty">${
      query ? "未找到匹配的生词" : "生词本为空"
    }</div>`;
  } else {
    // Sort by addedAt descending (newest first)
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.addedAt) - new Date(a.addedAt)
    );
    vocabListEl.innerHTML = sorted.map(renderItem).join("");
    bindItemEvents();
  }

  footerEl.textContent = `共 ${list.length} 个生词`;
}

/**
 * Render a single vocab item HTML.
 * @param {object} entry - VocabEntry.
 * @returns {string} HTML string.
 */
function renderItem(entry) {
  const date = new Date(entry.addedAt).toLocaleDateString("zh-CN");
  const contextHtml = entry.context
    ? `<div class="vocab-context">${escapeHtml(truncate(entry.context, 120))}</div>`
    : "";
  const sourceHtml = entry.sourceUrl
    ? `<a href="${escapeHtml(entry.sourceUrl)}" target="_blank" title="${escapeHtml(entry.sourceUrl)}">来源</a>`
    : "";

  return `
    <div class="vocab-item" data-word="${escapeHtml(entry.word)}">
      <div class="vocab-item-header">
        <span class="vocab-word">${escapeHtml(entry.word)}</span>
        <div class="vocab-actions">
          <button class="btn-edit" title="编辑翻译">✏️</button>
          <button class="btn-delete" title="删除">🗑️</button>
        </div>
      </div>
      <div class="vocab-translation">${escapeHtml(entry.translation)}</div>
      ${contextHtml}
      <div class="vocab-meta">
        <span>${date}</span>
        ${sourceHtml}
      </div>
    </div>
  `;
}

/** Bind click events for edit/delete buttons on rendered items. */
function bindItemEvents() {
  vocabListEl.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", handleEdit);
  });
  vocabListEl.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", handleDelete);
  });
}

// -----------------------------------------------------------------------
// Edit
// -----------------------------------------------------------------------

/**
 * Handle inline edit of a vocab item's translation.
 * @param {Event} e
 */
function handleEdit(e) {
  const item = e.target.closest(".vocab-item");
  const word = item.dataset.word;
  const translationEl = item.querySelector(".vocab-translation");
  const currentTranslation = translationEl.textContent;

  // Replace with input
  const input = document.createElement("input");
  input.type = "text";
  input.className = "vocab-translation-edit";
  input.value = currentTranslation;
  translationEl.replaceWith(input);
  input.focus();
  input.select();

  /** Save the edited translation. */
  async function saveEdit() {
    const newTranslation = input.value.trim();
    if (!newTranslation || newTranslation === currentTranslation) {
      // Revert
      const span = document.createElement("div");
      span.className = "vocab-translation";
      span.textContent = currentTranslation;
      input.replaceWith(span);
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: "UPDATE_WORD",
      payload: { word, translation: newTranslation },
    });

    if (result.success) {
      vocabData = result.vocabList;
      renderList(vocabData);
    }
  }

  input.addEventListener("blur", saveEdit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === "Escape") {
      input.value = currentTranslation;
      input.blur();
    }
  });
}

// -----------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------

/**
 * Handle deletion of a vocab item.
 * @param {Event} e
 */
async function handleDelete(e) {
  const item = e.target.closest(".vocab-item");
  const word = item.dataset.word;

  const result = await chrome.runtime.sendMessage({
    type: "DELETE_WORD",
    payload: { word },
  });

  if (result.success) {
    vocabData = result.vocabList;
    renderList(vocabData);

    // Notify content script to remove highlights for this word
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "REMOVE_HIGHLIGHT", payload: { word } });
      }
    } catch (_) { /* content script may not be loaded */ }
  }
}

// -----------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------

searchInput.addEventListener("input", () => {
  renderList(vocabData);
});

// -----------------------------------------------------------------------
// Scan current page
// -----------------------------------------------------------------------

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  scanBtn.textContent = "扫描中...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_SCAN" });
    }
  } catch (err) {
    // Content script may not be loaded on some pages (chrome://, etc.)
    console.warn("Failed to trigger scan:", err.message);
  }

  scanBtn.disabled = false;
  scanBtn.textContent = "扫描页面";
});

// -----------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

apiWarningLink.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// -----------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------

/** Escape HTML entities. */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Truncate a string to a max length, appending "..." if truncated.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}
