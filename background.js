/**
 * Vocab Highlighter — Service Worker (background script).
 * Handles translation API calls, vocabulary CRUD, and message routing.
 */

import { translateWord } from "./utils/api.js";

// ---------------------------------------------------------------------------
// Write serialization — promise queue prevents concurrent storage races
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();

/**
 * Enqueue a read-modify-write storage operation so writes are serialized.
 * @param {function} fn - Async function that performs the storage operation.
 * @returns {Promise<*>} Result of fn.
 */
function serializedWrite(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Read the full vocab list from storage.
 * @returns {Promise<Array>} Array of VocabEntry objects.
 */
async function getVocabList() {
  const { vocabList = [] } = await chrome.storage.local.get("vocabList");
  return vocabList;
}

/**
 * Read the API key and optional model override from storage.
 * @returns {Promise<{apiKey: string, model: string}>}
 */
async function getApiConfig() {
  const { apiKey = "", model = "" } = await chrome.storage.local.get([
    "apiKey",
    "model",
  ]);
  return { apiKey, model };
}

// ---------------------------------------------------------------------------
// Vocabulary operations (all run inside serializedWrite)
// ---------------------------------------------------------------------------

/**
 * Save a vocab entry. If the word already exists (case-insensitive), update it.
 * @param {object} entry - { word, translation, context, sourceUrl }
 * @returns {Promise<{updated: boolean}>} Whether an existing entry was updated.
 */
function saveVocabEntry(entry) {
  return serializedWrite(async () => {
    const vocabList = await getVocabList();
    const lowerWord = entry.word.toLowerCase();
    const existingIndex = vocabList.findIndex(
      (e) => e.word.toLowerCase() === lowerWord
    );

    const vocabEntry = {
      word: entry.word,
      translation: entry.translation,
      context: entry.context || "",
      sourceUrl: entry.sourceUrl || "",
      addedAt: new Date().toISOString(),
    };

    let updated = false;
    if (existingIndex >= 0) {
      // Preserve original addedAt, update everything else
      vocabEntry.addedAt = vocabList[existingIndex].addedAt;
      vocabList[existingIndex] = vocabEntry;
      updated = true;
    } else {
      vocabList.push(vocabEntry);
    }

    await chrome.storage.local.set({ vocabList });
    return { updated };
  });
}

/**
 * Delete a word from the vocab list (case-insensitive match).
 * @param {string} word
 * @returns {Promise<{success: boolean, vocabList: Array}>}
 */
function deleteVocabEntry(word) {
  return serializedWrite(async () => {
    let vocabList = await getVocabList();
    const lowerWord = word.toLowerCase();
    vocabList = vocabList.filter((e) => e.word.toLowerCase() !== lowerWord);
    await chrome.storage.local.set({ vocabList });
    return { success: true, vocabList };
  });
}

/**
 * Update the translation for an existing word.
 * @param {string} word
 * @param {string} translation
 * @returns {Promise<{success: boolean, vocabList: Array}>}
 */
function updateVocabEntry(word, translation) {
  return serializedWrite(async () => {
    const vocabList = await getVocabList();
    const lowerWord = word.toLowerCase();
    const entry = vocabList.find((e) => e.word.toLowerCase() === lowerWord);
    if (entry) {
      entry.translation = translation;
    }
    await chrome.storage.local.set({ vocabList });
    return { success: !!entry, vocabList };
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case "TRANSLATE_WORD": {
      (async () => {
        try {
          const { apiKey, model } = await getApiConfig();
          if (!apiKey) {
            sendResponse({
              success: false,
              error: "API key not configured. Please set it in extension settings.",
            });
            return;
          }

          const translation = await translateWord(
            apiKey,
            payload.word,
            payload.paragraph,
            model || undefined
          );

          const { updated } = await saveVocabEntry({
            word: payload.word,
            translation,
            context: payload.paragraph,
            sourceUrl: payload.sourceUrl,
          });

          sendResponse({ success: true, translation, updated });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // async response
    }

    case "SCAN_PAGE": {
      getVocabList().then((vocabList) => {
        sendResponse(vocabList);
      });
      return true;
    }

    case "DELETE_WORD": {
      deleteVocabEntry(payload.word).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    case "UPDATE_WORD": {
      updateVocabEntry(payload.word, payload.translation).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    default:
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
      return false;
  }
});
