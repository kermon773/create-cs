/**
 * ZeroGPT checker via website's internal endpoint.
 * Mencoba beberapa variasi header agar lebih reliable.
 */
const axios = require('axios');

const ZEROGPT_URL = 'https://api.zerogpt.com/api/detect/detectText';

// Header utama yang ditiru dari browser
const HEADERS_PRIMARY = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.zerogpt.com',
  'Referer': 'https://www.zerogpt.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site'
};

// Header fallback tanpa Sec-Fetch
const HEADERS_FALLBACK = {
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'Origin': 'https://www.zerogpt.com',
  'Referer': 'https://www.zerogpt.com/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36'
};

/**
 * Split teks menjadi array kalimat.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

/**
 * Coba satu kali request ke ZeroGPT.
 */
async function tryRequest(headers, text) {
  const response = await axios.post(
    ZEROGPT_URL,
    { input_text: text },
    { headers, timeout: 30000 }
  );
  return response.data;
}

/**
 * Parse response ZeroGPT menjadi format standar.
 */
function parseResponse(data, text) {
  const inner = data?.data ?? data;

  const aiScore = Math.round(
    inner?.fakePercentage ?? inner?.aiScore ?? inner?.ai_score ?? inner?.fake_percentage ?? 0
  );
  const isHuman = inner?.isHuman ?? inner?.is_human ?? (100 - aiScore);

  // Ekstrak highlighted sentences (kalimat highlight kuning)
  const rawWords =
    inner?.textWords ??
    inner?.sentences ??
    inner?.highlighted_sentences ??
    inner?.aiSentences ??
    [];

  let highlightedSentences = [];

  if (Array.isArray(rawWords) && rawWords.length > 0) {
    if (typeof rawWords[0] === 'object') {
      highlightedSentences = rawWords
        .filter(w => {
          const humanFlag = w?.isHuman ?? w?.is_human ?? w?.human ?? 1;
          return humanFlag === 0 || humanFlag === false;
        })
        .map(w => (w?.sentence ?? w?.text ?? w?.content ?? '').trim())
        .filter(s => s.length > 5);
    } else if (typeof rawWords[0] === 'string') {
      highlightedSentences = rawWords.map(s => s.trim()).filter(s => s.length > 5);
    }
  }

  // Fallback: jika API tidak mengembalikan highlighted tapi score > 0
  if (highlightedSentences.length === 0 && aiScore > 0) {
    const allSentences = splitSentences(text);
    const countToTake = Math.max(1, Math.ceil(allSentences.length * (aiScore / 100)));
    const startIdx = Math.floor((allSentences.length - countToTake) / 2);
    highlightedSentences = allSentences.slice(startIdx, startIdx + countToTake);
    console.warn(`[ZeroGPT] textWords kosong, fallback split: ${highlightedSentences.length}/${allSentences.length} kalimat (${aiScore}% AI)`);
  }

  return { aiScore, isHuman, highlightedSentences };
}

/**
 * Check text against ZeroGPT.
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
  const attempts = [
    { label: 'primary', headers: HEADERS_PRIMARY },
    { label: 'fallback', headers: HEADERS_FALLBACK }
  ];

  for (const { label, headers } of attempts) {
    try {
      console.log(`[ZeroGPT] Mencoba request (${label})...`);
      const data = await tryRequest(headers, text);
      const { aiScore, isHuman, highlightedSentences } = parseResponse(data, text);

      console.log(`[ZeroGPT] Score: ${aiScore}% AI | Highlighted: ${highlightedSentences.length} kalimat`);

      return {
        passed: aiScore === 0,
        aiScore,
        isHuman,
        skipped: false,
        highlightedSentences
      };

    } catch (err) {
      const status = err?.response?.status;
      const msg    = err?.response?.data?.message || err.message;
      console.warn(`[ZeroGPT] Request ${label} gagal (${status ?? 'network'}): ${msg}`);
      // Lanjut ke attempt berikutnya
    }
  }

  // Semua attempt gagal
  console.warn('[ZeroGPT] Semua attempt gagal — API tidak tersedia.');
  return { passed: false, aiScore: -1, isHuman: 0, skipped: true, highlightedSentences: [] };
}

module.exports = { isHumanText };
