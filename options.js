/**
 * Vocab Highlighter — Options page logic.
 * Load/save API key and optional model override to chrome.storage.local.
 */

const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

// Load saved settings
chrome.storage.local.get(["apiKey", "model"], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.model) modelInput.value = data.model;
});

// Save settings
saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();

  chrome.storage.local.set({ apiKey, model }, () => {
    statusEl.style.display = "block";
    setTimeout(() => {
      statusEl.style.display = "none";
    }, 2000);
  });
});
