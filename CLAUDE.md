# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vocab Highlighter is a Chrome Extension (Manifest V3) that helps users build vocabulary while reading English web pages. It provides context-aware word translation via OpenRouter API and highlights previously saved words on any page.

## Tech Stack

- **Chrome Extension Manifest V3** (no build step — load unpacked in `chrome://extensions`)
- **Translation API**: OpenRouter (user-configured API key, stored in `chrome.storage.local`)
- **Storage**: `chrome.storage.local` for vocabulary data and settings
- **Languages**: Vanilla JavaScript, HTML, CSS (no frameworks)

## Development

### Loading the extension
1. Open `chrome://extensions/` with Developer mode enabled
2. Click "Load unpacked" and select the project root directory
3. Reload the extension after code changes

### No build/test/lint commands
This is a vanilla Chrome extension with no build pipeline, bundler, or test framework.

## Architecture

### Core data flow
- **content.js** (content script): Detects word selection on web pages, shows a floating popup with "translate & add" button, and scans pages to highlight saved vocabulary words with hover tooltips.
- **background.js** (Service Worker): Handles OpenRouter API calls for translation. Content script sends messages to background for API requests (content scripts can't directly call external APIs due to CORS).
- **popup.html/js**: Vocabulary list management UI — view, edit, delete saved words; configure API key.
- **options.html/js**: API key configuration page.
- **utils/api.js**: OpenRouter API wrapper.

### Message passing pattern
`content.js` ←→ `background.js` via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. Content script detects selections and sends the word + surrounding paragraph to background for translation.

### Vocabulary data structure
```json
{
  "word": "ephemeral",
  "translation": "短暂的、转瞬即逝的",
  "context": "The ephemeral nature of cherry blossoms makes them...",
  "sourceUrl": "https://example.com/article",
  "addedAt": "2026-02-11T10:30:00Z"
}
```

### Word scanning logic
Page scanning uses `\b` word boundary regex (case-insensitive) against text nodes in the DOM. Matched words get yellow background highlighting and a hover tooltip showing the Chinese translation.

## Key Permissions
- `storage`: Persist vocabulary and API key
- `activeTab`: Access current tab content
- `host_permissions`: `https://openrouter.ai/*` for translation API calls
- Content scripts injected on `<all_urls>`
