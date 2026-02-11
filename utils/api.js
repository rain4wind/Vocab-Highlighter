/**
 * OpenRouter API wrapper for word translation.
 */

const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Translate an English word in context to Chinese using OpenRouter API.
 * @param {string} apiKey - OpenRouter API key.
 * @param {string} word - The English word to translate.
 * @param {string} paragraphText - Surrounding paragraph for context.
 * @param {string} [model] - OpenRouter model ID override.
 * @returns {Promise<string>} Chinese translation string.
 */
export async function translateWord(apiKey, word, paragraphText, model) {
  const selectedModel = model || DEFAULT_MODEL;
  const prompt = `请翻译以下英文单词在该语境中的含义，只返回中文翻译，简洁准确。\n段落：${paragraphText}\n单词：${word}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error("API returned no choices");
  }

  const content = data.choices[0].message?.content?.trim();
  if (!content) {
    throw new Error("API returned empty translation");
  }

  return content;
}
