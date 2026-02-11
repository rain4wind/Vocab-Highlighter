/**
 * Vocab Highlighter — Content Script.
 * Handles word selection popup, page scanning, highlighting, and tooltips.
 * Uses Shadow DOM (closed) for popup/tooltip UI isolation.
 */

(() => {
  "use strict";

  // Prevent double-injection
  if (window.__vocabHighlighterLoaded) return;
  window.__vocabHighlighterLoaded = true;

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  const WORD_REGEX = /^[a-zA-Z'-]+$/;
  const MAX_WORD_LENGTH = 45;
  const MAX_PARAGRAPH_LENGTH = 500;
  const BLOCK_ELEMENTS = new Set([
    "P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
    "ARTICLE", "SECTION", "TD", "TH", "DD", "DT", "PRE", "FIGCAPTION",
  ]);
  const SKIP_ELEMENTS = new Set([
    "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED",
  ]);

  // -----------------------------------------------------------------------
  // Inject host-page styles (highlight + badge)
  // -----------------------------------------------------------------------
  const hostStyle = document.createElement("style");
  hostStyle.textContent = `
    .vh-highlight {
      background-color: #fff176 !important;
      border-radius: 2px !important;
      padding: 0 1px !important;
      cursor: pointer !important;
      transition: background-color 0.2s !important;
    }
    .vh-highlight:hover {
      background-color: #ffee58 !important;
    }
    .vh-badge {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 2147483646 !important;
      background: #1976d2 !important;
      color: #fff !important;
      font-size: 14px !important;
      padding: 8px 16px !important;
      border-radius: 8px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      font-family: system-ui, sans-serif !important;
      pointer-events: none !important;
      opacity: 1 !important;
      transition: opacity 0.5s ease !important;
    }
    .vh-badge.vh-fade-out {
      opacity: 0 !important;
    }
  `;
  document.head.appendChild(hostStyle);

  // -----------------------------------------------------------------------
  // Shadow DOM root for popup & tooltip
  // -----------------------------------------------------------------------
  const hostEl = document.createElement("div");
  hostEl.id = "vocab-highlighter-root";
  hostEl.style.cssText = "all:initial; position:absolute; z-index:2147483647;";
  document.body.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: "closed" });

  const shadowStyle = document.createElement("style");
  shadowStyle.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Popup */
    .vh-popup {
      position: fixed;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 14px 16px;
      min-width: 220px;
      max-width: 340px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      color: #333;
      line-height: 1.5;
      display: none;
    }
    .vh-popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .vh-popup-word {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
    }
    .vh-popup-close {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      color: #999;
      padding: 0 2px;
      line-height: 1;
    }
    .vh-popup-close:hover { color: #333; }
    .vh-popup-btn {
      display: block;
      width: 100%;
      padding: 8px 0;
      background: #1976d2;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .vh-popup-btn:hover { background: #1565c0; }
    .vh-popup-btn:disabled {
      background: #bdbdbd;
      cursor: not-allowed;
    }
    .vh-popup-translation {
      margin-top: 10px;
      padding: 8px 10px;
      background: #f5f5f5;
      border-radius: 6px;
      font-size: 15px;
      color: #222;
    }
    .vh-popup-status {
      margin-top: 8px;
      font-size: 12px;
      color: #4caf50;
    }
    .vh-popup-error {
      margin-top: 8px;
      font-size: 12px;
      color: #e53935;
    }
    .vh-popup-retry {
      background: none;
      border: 1px solid #e53935;
      color: #e53935;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      margin-top: 6px;
    }
    .vh-popup-retry:hover { background: #ffebee; }
    .vh-popup-hint {
      margin-top: 8px;
      font-size: 12px;
      color: #ff9800;
    }
    .vh-popup-loading {
      margin-top: 10px;
      font-size: 13px;
      color: #757575;
    }

    /* Tooltip */
    .vh-tooltip {
      position: fixed;
      z-index: 2147483647;
      background: #424242;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      max-width: 280px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      pointer-events: none;
      display: none;
    }
  `;
  shadow.appendChild(shadowStyle);

  // Popup element
  const popup = document.createElement("div");
  popup.className = "vh-popup";
  shadow.appendChild(popup);

  // Tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "vh-tooltip";
  shadow.appendChild(tooltip);

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let currentWord = "";
  let currentParagraph = "";
  let isTranslating = false;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Walk up from a node to find the nearest block-level ancestor and return
   * a text window centered around the selected word.
   * @param {Node} node
   * @param {string} word - The selected word, used to center the context window.
   * @returns {string} Paragraph text, capped at MAX_PARAGRAPH_LENGTH.
   */
  function getEnclosingParagraphText(node, word) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && !BLOCK_ELEMENTS.has(el.tagName)) {
      el = el.parentElement;
    }
    const text = (el || document.body).textContent || "";

    if (text.length <= MAX_PARAGRAPH_LENGTH) {
      return text.trim();
    }

    // Find the word position and extract a window centered on it
    const wordIndex = text.toLowerCase().indexOf(word.toLowerCase());
    if (wordIndex === -1) {
      return text.slice(0, MAX_PARAGRAPH_LENGTH).trim();
    }

    const half = Math.floor(MAX_PARAGRAPH_LENGTH / 2);
    let start = wordIndex - half;
    let end = wordIndex + half;

    if (start < 0) {
      end = Math.min(text.length, end - start);
      start = 0;
    }
    if (end > text.length) {
      start = Math.max(0, start - (end - text.length));
      end = text.length;
    }

    return text.slice(start, end).trim();
  }

  /**
   * Position an element near a DOMRect, clamped within the viewport.
   * @param {HTMLElement} el - The element to position (must be display:block/flex first).
   * @param {DOMRect} rect - Selection bounding rect.
   */
  function positionNear(el, rect) {
    const gap = 8;
    let top = rect.bottom + gap;
    let left = rect.left;

    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const elRect = el.getBoundingClientRect();

    if (left + elRect.width > vw - 10) left = vw - elRect.width - 10;
    if (left < 10) left = 10;
    if (top + elRect.height > vh - 10) top = rect.top - elRect.height - gap;
    if (top < 10) top = 10;

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  // -----------------------------------------------------------------------
  // Popup management
  // -----------------------------------------------------------------------

  /**
   * Show the popup near the selection with a translate button.
   * @param {string} word
   * @param {DOMRect} rect - Selection bounding rect.
   */
  function showPopup(word, rect) {
    currentWord = word;
    currentParagraph = getEnclosingParagraphText(
      window.getSelection().anchorNode,
      word
    );

    popup.innerHTML = `
      <div class="vh-popup-header">
        <span class="vh-popup-word">${escapeHtml(word)}</span>
        <button class="vh-popup-close" title="关闭">&times;</button>
      </div>
      <button class="vh-popup-btn">翻译并添加</button>
    `;
    popup.style.display = "block";
    positionNear(popup, rect);

    // Bind events
    popup.querySelector(".vh-popup-close").addEventListener("click", hidePopup);
    popup.querySelector(".vh-popup-btn").addEventListener("click", () => {
      requestTranslation();
    });
  }

  /** Hide the popup. */
  function hidePopup() {
    popup.style.display = "none";
    popup.innerHTML = "";
    isTranslating = false;
  }

  /**
   * Request translation from background and update popup with result.
   */
  async function requestTranslation() {
    if (isTranslating) return;
    isTranslating = true;

    const btn = popup.querySelector(".vh-popup-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "翻译中...";
    }

    // Remove any previous error/status
    popup.querySelectorAll(".vh-popup-error, .vh-popup-status, .vh-popup-retry, .vh-popup-translation, .vh-popup-hint, .vh-popup-loading")
      .forEach((el) => el.remove());

    const loadingEl = document.createElement("div");
    loadingEl.className = "vh-popup-loading";
    loadingEl.textContent = "正在翻译...";
    popup.appendChild(loadingEl);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_WORD",
        payload: {
          word: currentWord,
          paragraph: currentParagraph,
          sourceUrl: window.location.href,
        },
      });

      loadingEl.remove();

      if (response.success) {
        // Show translation
        const transEl = document.createElement("div");
        transEl.className = "vh-popup-translation";
        transEl.textContent = response.translation;
        popup.appendChild(transEl);

        // Show status
        const statusEl = document.createElement("div");
        statusEl.className = "vh-popup-status";
        statusEl.textContent = response.updated
          ? "已更新到生词本 ✓"
          : "已添加到生词本 ✓";
        popup.appendChild(statusEl);

        if (btn) btn.style.display = "none";

        // Immediately highlight this word on the page
        highlightSingleWord(currentWord, response.translation);
      } else {
        showError(response.error);
      }
    } catch (err) {
      loadingEl.remove();
      showError(err.message || "Translation request failed");
    }

    isTranslating = false;
  }

  /**
   * Show an error message in the popup with optional retry button.
   * @param {string} errorMsg
   */
  function showError(errorMsg) {
    const btn = popup.querySelector(".vh-popup-btn");

    if (errorMsg.includes("API key")) {
      const hintEl = document.createElement("div");
      hintEl.className = "vh-popup-hint";
      hintEl.textContent = "请先在扩展设置中配置 API Key";
      popup.appendChild(hintEl);
      if (btn) {
        btn.disabled = true;
        btn.textContent = "翻译并添加";
      }
    } else {
      const errorEl = document.createElement("div");
      errorEl.className = "vh-popup-error";
      errorEl.textContent = errorMsg;
      popup.appendChild(errorEl);

      const retryBtn = document.createElement("button");
      retryBtn.className = "vh-popup-retry";
      retryBtn.textContent = "重试";
      retryBtn.addEventListener("click", () => {
        isTranslating = false;
        requestTranslation();
      });
      popup.appendChild(retryBtn);

      if (btn) {
        btn.disabled = false;
        btn.textContent = "翻译并添加";
      }
    }
  }

  /** Escape HTML entities. */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // -----------------------------------------------------------------------
  // Selection listener
  // -----------------------------------------------------------------------

  document.addEventListener("mouseup", (e) => {
    // Ignore clicks inside our own UI
    if (hostEl.contains(e.target) || e.target.closest?.("#vocab-highlighter-root")) {
      return;
    }

    // Small delay to let selection finalize
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        // Click outside popup closes it
        if (popup.style.display === "block" && !isTranslating) {
          hidePopup();
        }
        return;
      }

      const word = sel.toString().trim();

      // Validate: single English word
      if (!word || !WORD_REGEX.test(word) || word.length > MAX_WORD_LENGTH) {
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      showPopup(word, rect);
    }, 10);
  });

  // Close popup on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopup();
  });

  // -----------------------------------------------------------------------
  // Page scanning & highlighting (P1)
  // -----------------------------------------------------------------------

  /** Currently active badge element */
  let activeBadge = null;

  /**
   * Scan the page for saved vocabulary words and highlight them.
   */
  async function scanPageForVocab() {
    // Remove previous highlights
    removeHighlights();

    // Fetch vocab list from background
    const vocabList = await chrome.runtime.sendMessage({
      type: "SCAN_PAGE",
      payload: {},
    });

    if (!vocabList || vocabList.length === 0) return;

    // Build a map for quick translation lookup (lowercase → entry)
    const vocabMap = new Map();
    for (const entry of vocabList) {
      vocabMap.set(entry.word.toLowerCase(), entry);
    }

    // Build combined regex: \b(word1|word2|...)\b
    const escaped = vocabList.map((e) =>
      e.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

    // Walk text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_ELEMENTS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("#vocab-highlighter-root")) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains("vh-highlight")) return NodeFilter.FILTER_REJECT;
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    let matchCount = 0;

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      if (!text || !pattern.test(text)) continue;
      // Reset lastIndex after test
      pattern.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        // Create highlighted mark
        const mark = document.createElement("mark");
        mark.className = "vh-highlight";
        mark.textContent = match[0];

        const entry = vocabMap.get(match[0].toLowerCase());
        if (entry) {
          mark.dataset.vhTranslation = entry.translation;
          mark.dataset.vhWord = entry.word;
        }

        frag.appendChild(mark);
        lastIndex = pattern.lastIndex;
        matchCount++;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(frag, textNode);
    }

    // Show badge
    if (matchCount > 0) {
      showBadge(matchCount);
    }
  }

  /**
   * Highlight a single word across the page (called after adding a new word).
   * @param {string} word - The word to highlight.
   * @param {string} translation - Its translation for the tooltip.
   */
  function highlightSingleWord(word, translation) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b(${escaped})\\b`, "gi");

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_ELEMENTS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("#vocab-highlighter-root")) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains("vh-highlight")) return NodeFilter.FILTER_REJECT;
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      if (!text || !pattern.test(text)) continue;
      pattern.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const mark = document.createElement("mark");
        mark.className = "vh-highlight";
        mark.textContent = match[0];
        mark.dataset.vhTranslation = translation;
        mark.dataset.vhWord = word;
        frag.appendChild(mark);
        lastIndex = pattern.lastIndex;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  /** Remove all existing highlights from the page. */
  function removeHighlights() {
    const marks = document.querySelectorAll("mark.vh-highlight");
    for (const mark of marks) {
      const parent = mark.parentNode;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parent.normalize(); // merge adjacent text nodes
    }
  }

  /**
   * Remove highlights for a specific word (called when word is deleted from vocab).
   * @param {string} word
   */
  function removeHighlightForWord(word) {
    const lowerWord = word.toLowerCase();
    const marks = document.querySelectorAll("mark.vh-highlight");
    for (const mark of marks) {
      if (mark.textContent.toLowerCase() === lowerWord) {
        const parent = mark.parentNode;
        const text = document.createTextNode(mark.textContent);
        parent.replaceChild(text, mark);
        parent.normalize();
      }
    }
  }

  /**
   * Show the "本页发现 X 个生词" badge and auto-fade after 5 seconds.
   * @param {number} count
   */
  function showBadge(count) {
    // Remove existing badge
    if (activeBadge) {
      activeBadge.remove();
      activeBadge = null;
    }

    const badge = document.createElement("div");
    badge.className = "vh-badge";
    badge.textContent = `本页发现 ${count} 个生词`;
    document.body.appendChild(badge);
    activeBadge = badge;

    setTimeout(() => {
      badge.classList.add("vh-fade-out");
      setTimeout(() => {
        badge.remove();
        if (activeBadge === badge) activeBadge = null;
      }, 500);
    }, 5000);
  }

  // -----------------------------------------------------------------------
  // Tooltip for highlighted words
  // -----------------------------------------------------------------------

  document.addEventListener("mouseenter", (e) => {
    if (!e.target.classList?.contains("vh-highlight")) return;
    const translation = e.target.dataset.vhTranslation;
    const word = e.target.dataset.vhWord || e.target.textContent;
    if (!translation) return;

    tooltip.innerHTML = `<strong>${escapeHtml(word)}</strong>: ${escapeHtml(translation)}`;
    tooltip.style.display = "block";

    const rect = e.target.getBoundingClientRect();
    const gap = 6;
    let top = rect.top - tooltip.offsetHeight - gap;
    let left = rect.left;

    // Clamp within viewport
    if (top < 10) top = rect.bottom + gap;
    if (left + tooltip.offsetWidth > window.innerWidth - 10) {
      left = window.innerWidth - tooltip.offsetWidth - 10;
    }
    if (left < 10) left = 10;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }, true);

  document.addEventListener("mouseleave", (e) => {
    if (!e.target.classList?.contains("vh-highlight")) return;
    tooltip.style.display = "none";
  }, true);

  // -----------------------------------------------------------------------
  // Listen for TRIGGER_SCAN from popup
  // -----------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TRIGGER_SCAN") {
      scanPageForVocab().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
    if (message.type === "REMOVE_HIGHLIGHT") {
      removeHighlightForWord(message.payload.word);
      sendResponse({ success: true });
    }
  });

  // -----------------------------------------------------------------------
  // Auto-scan on page load
  // -----------------------------------------------------------------------
  scanPageForVocab();
})();
