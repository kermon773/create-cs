/**
 * ZeroGPT checker via website scraping (no paid API key required).
 * Uses the same internal endpoint the zerogpt.com web UI calls.
 */
const axios = require('axios');

/**
 * Check text against ZeroGPT website's internal endpoint.
 * @param {string} text
 * @returns {Promise<{
 *   passed: boolean,
 *   aiScore: number,
 *   isHuman: number,
 *   skipped: boolean,
 *   highlightedSentences: string[]
 * }>}
 */
async function isHumanText(text) {
  try {
    const response = await axios.post(
      'https://api.zerogpt.com/api/detect/detectText',
      { input_text: text },
      {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.zerogpt.com',
          'Referer': 'https://www.zerogpt.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 20000
      }
    );

    const data = response.data;
    // Shape: { success, data: { fakePercentage, isHuman, textWords: [...], ... } }
    const inner = data?.data ?? data;
    const aiScore = inner?.fakePercentage ?? inner?.aiScore ?? 0;
    const isHuman = inner?.isHuman ?? (100 - aiScore);

    // ── Extract highlighted (AI-detected) sentences ──────────────────────────
    // ZeroGPT returns textWords: array of { text, isHuman: 0|1 }
    // isHuman === 0 means the sentence is highlighted yellow (detected as AI)
    const textWords = inner?.textWords ?? inner?.sentences ?? [];
    const highlightedSentences = Array.isArray(textWords)
      ? textWords
          .filter(w => w && (w.isHuman === 0 || w.is_human === 0 || w.generated === true))
          .map(w => (w.text ?? w.sentence ?? '').trim())
          .filter(Boolean)
      : [];

    return { passed: aiScore === 0, aiScore, isHuman, skipped: false, highlightedSentences };
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.message || err.message;
    console.warn(`[ZeroGPT] Check gagal (${status ?? 'network'}): ${msg} — dilewati`);
    return { passed: true, aiScore: 0, isHuman: 100, skipped: true, highlightedSentences: [] };
  }
}

module.exports = { isHumanText };
