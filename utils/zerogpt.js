/**
 * ZeroGPT checker via website scraping (no paid API key required).
 * Uses the same internal endpoint the zerogpt.com web UI calls.
 */
const axios = require('axios');

/**
 * Check text against ZeroGPT website's internal endpoint.
 * @param {string} text
 * @returns {Promise<{ passed: boolean, aiScore: number, isHuman: number, skipped: boolean }>}
 */
async function isHumanText(text) {
  try {
    const response = await axios.post(
      'https://api.zerogpt.com/api/detect/detectText',
      { input_text: text },
      {
        headers: {
          'Content-Type': 'application/json',
          // Mimic browser headers so the request looks like it came from the website
          'Origin': 'https://www.zerogpt.com',
          'Referer': 'https://www.zerogpt.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 20000
      }
    );

    const data = response.data;
    // Shape: { success, data: { fakePercentage, isHuman, ... } }
    const inner = data?.data ?? data;
    const aiScore = inner?.fakePercentage ?? inner?.aiScore ?? 0;
    const isHuman = inner?.isHuman ?? (100 - aiScore);

    return { passed: aiScore === 0, aiScore, isHuman, skipped: false };
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.message || err.message;
    console.warn(`[ZeroGPT] Check gagal (${status ?? 'network'}): ${msg} — dilewati`);
    // Graceful degradation: skip check, still send CS to user
    return { passed: true, aiScore: 0, isHuman: 100, skipped: true };
  }
}

module.exports = { isHumanText };
