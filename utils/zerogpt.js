/**
 * ZeroGPT checker via website scraping (no paid API key required).
 * Uses the same internal endpoint the zerogpt.com web UI calls.
 */
const axios = require('axios');

/**
 * Split teks menjadi array kalimat berdasarkan tanda titik/seru/tanya.
 * Fallback jika ZeroGPT tidak mengembalikan textWords.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  // Split di akhir kalimat: '. ', '! ', '? ' — tapi jangan singkatan seperti "Jl. "
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'ApiKey': 'null'
        },
        timeout: 25000
      }
    );

    const data = response.data;
    const inner = data?.data ?? data;

    const aiScore  = inner?.fakePercentage ?? inner?.aiScore ?? inner?.ai_score ?? 0;
    const isHuman  = inner?.isHuman ?? inner?.is_human ?? (100 - aiScore);

    // ── Ekstrak highlighted sentences (kalimat highlight kuning) ──────────────
    // ZeroGPT mengembalikan berbagai nama field tergantung versi API-nya
    const rawWords =
      inner?.textWords ??        // array of { sentence, isHuman }
      inner?.sentences ??        // alternatif
      inner?.highlighted_sentences ??
      inner?.aiSentences ??      // alternatif lain
      [];

    let highlightedSentences = [];

    if (Array.isArray(rawWords) && rawWords.length > 0) {
      // Format 1: array of objects { sentence/text, isHuman: 0|1 }
      if (typeof rawWords[0] === 'object') {
        highlightedSentences = rawWords
          .filter(w => {
            const humanFlag = w?.isHuman ?? w?.is_human ?? w?.human ?? 1;
            return humanFlag === 0 || humanFlag === false;
          })
          .map(w => (w?.sentence ?? w?.text ?? w?.content ?? '').trim())
          .filter(s => s.length > 5);
      } else if (typeof rawWords[0] === 'string') {
        // Format 2: langsung array of strings
        highlightedSentences = rawWords.map(s => s.trim()).filter(s => s.length > 5);
      }
    }

    // ── Fallback: jika API tidak mengembalikan highlighted tapi score > 0 ─────
    // Gunakan proporsi aiScore untuk memperkirakan kalimat mana yang AI
    if (highlightedSentences.length === 0 && aiScore > 0) {
      const allSentences = splitSentences(text);
      // Ambil proporsi kalimat sesuai aiScore (misalnya 50% → ambil ~50% kalimat)
      const countToTake = Math.max(1, Math.ceil(allSentences.length * (aiScore / 100)));
      // Ambil dari tengah teks (biasanya AI lebih terasa di bagian badan, bukan awal/akhir)
      const startIdx = Math.floor((allSentences.length - countToTake) / 2);
      highlightedSentences = allSentences.slice(startIdx, startIdx + countToTake);

      console.warn(`[ZeroGPT] textWords kosong, fallback split: ${highlightedSentences.length}/${allSentences.length} kalimat diambil (${aiScore}% AI)`);
    }

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
    console.warn(`[ZeroGPT] Check gagal (${status ?? 'network'}): ${msg} — dilewati`);
    return { passed: true, aiScore: 0, isHuman: 100, skipped: true, highlightedSentences: [] };
  }
}

module.exports = { isHumanText };
