const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const ambiguitas = JSON.parse(fs.readFileSync(path.join(__dirname, 'ambiguitas.json'), 'utf-8'));

// ─── System prompts ──────────────────────────────────────────────────────────

const BASE_RULES = `
LARANGAN KERAS (JANGAN PERNAH DILANGGAR):
- DILARANG menggunakan format Markdown apapun: tidak boleh ada #, ##, ###, **, *, __, --, ---, >, ` + '`' + `, atau tag HTML seperti &nbsp;
- DILARANG menggunakan emoji apapun di dalam teks cerita
- DILARANG menulis judul/heading apapun di dalam teks
- DILARANG menggunakan bullet point atau daftar
- DILARANG menggunakan tanda baca berulang seperti "---" atau "==="
- Output HANYA berupa paragraf teks murni, tidak ada apapun selain paragraf

FORMAT WAJIB:
- Setiap paragraf diawali tepat 3 (tiga) spasi, lalu langsung teks
- Antar paragraf dipisahkan 1 baris kosong
- Tidak ada teks sebelum paragraf pertama
- Tidak ada teks sesudah paragraf terakhir

GAYA BAHASA WAJIB (ambiguitas):
- Kalimat yang bisa diartikan lebih dari satu cara — jangan pernah eksplisit
- Hindari penjelasan langsung tentang aktivitas karakter
- Gunakan metafora pekerjaan/kegiatan sehari-hari sebagai "layar"
- Jangan pernah sebut hal negatif, kriminal, atau mencurigakan secara langsung
- Batas antara pekerjaan resmi dan hal lain harus selalu "kabur"
- Akhiri dengan kalimat yang tidak memberi kesimpulan pasti
- Gunakan bahasa Indonesia yang natural, mengalir, dan terasa seperti tulisan manusia biasa
- Jangan gunakan kata "dia" terlalu sering — ganti dengan nama karakter atau kata ganti implisit`;

const SYSTEM_PROMPT = `Kamu adalah penulis cerita karakter roleplay Indonesia.
Tugasmu: menulis Character Story dengan gaya penulisan AMBIGU dan terasa 100% ditulis manusia.

CONTOH GAYA TULISAN YANG WAJIB DITIRU PERSIS:
${ambiguitas.contoh_teks[0].teks}

KATA KUNCI AMBIGUITAS YANG HARUS MUNCUL DALAM TULISAN:
${ambiguitas.kata_kunci_ambiguitas.map((k, i) => `${i + 1}. "${k}"`).join('\n')}
${BASE_RULES}`;

// Prompt eskalasi untuk retry — semakin ketat semakin tinggi attempt
const RETRY_SYSTEM_PROMPTS = [
  // attempt 2
  `Kamu adalah penulis Indonesia. Tulis Character Story persis seperti tulisan manusia asli — 
bukan AI. Detector AI mendeteksi tulisan sebelumnya. Perbaiki dengan menulis lebih natural, 
lebih personal, lebih tidak beraturan seperti manusia sungguhan.

CONTOH YANG HARUS DITIRU:
${ambiguitas.contoh_teks[0].teks}
${BASE_RULES}`,

  // attempt 3
  `Kamu adalah manusia yang sedang menulis cerita karakter. 
Tulis dengan variasi kalimat pendek-panjang yang tidak terduga seperti manusia asli.
Gunakan gaya bercerita oral — seperti orang bercerita ke temannya.
Detector AI masih mendeteksi tulisan sebelumnya karena terlalu "sempurna" dan berstruktur AI.
Buat lebih acak, lebih personal, lebih "tidak sempurna" tapi tetap ambigu.

CONTOH:
${ambiguitas.contoh_teks[0].teks}
${BASE_RULES}`,

  // attempt 4+
  `Bayangkan kamu adalah teman yang menceritakan kisah hidup seseorang kepada teman lain secara informal.
Gunakan variasi kalimat yang sangat tidak terduga. Sesekali kalimat sangat pendek, lalu sangat panjang.
Hindari pola "Subjek + predikat + objek" yang berulang — itu yang membuat tulisan terdeteksi AI.
Mulai beberapa kalimat dari tengah cerita, bukan dari awal yang formal.

CONTOH GAYA:
${ambiguitas.contoh_teks[0].teks}
${BASE_RULES}`
];

// ─── Markdown stripper ────────────────────────────────────────────────────────

/**
 * Remove ALL markdown artifacts and HTML entities from AI output.
 * Ensures the final text is clean plain-text paragraphs only.
 * @param {string} raw
 * @returns {string}
 */
function cleanCSText(raw) {
  return raw
    // HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Markdown headings (#, ##, ###, etc.)
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic: **text**, *text*, __text__, _text_
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Inline code & code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`(.+?)`/g, '$1')
    // Horizontal rules
    .replace(/^(-{3,}|={3,}|\*{3,})$/gm, '')
    // Blockquotes
    .replace(/^>\s*/gm, '')
    // Bullet/numbered lists
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Leading emoji on lines (common AI habit: "🌾 Character Story")
    .replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+\s*/gmu, '')
    // Trailing whitespace per line
    .replace(/[ \t]+$/gm, '')
    // Collapse 3+ consecutive blank lines into 1
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── SSE parser ───────────────────────────────────────────────────────────────

const DONE_SENTINELS = new Set(["[DONE]", "'[DONE]'", '"[DONE]"', "data: [DONE]"]);

/**
 * @param {import('stream').Readable} stream
 * @returns {Promise<string>}
 */
function parseSSEStream(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let fullText = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const raw = trimmed.slice(5).trim();
        if (DONE_SENTINELS.has(raw)) continue;

        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed.answer === 'string')                    { fullText += parsed.answer; continue; }
          if (parsed.choices?.[0]?.delta?.content)                  { fullText += parsed.choices[0].delta.content; continue; }
          if (parsed.choices?.[0]?.message?.content)                { fullText += parsed.choices[0].message.content; continue; }
          if (typeof parsed.text === 'string')                      { fullText += parsed.text; continue; }
          if (typeof parsed.content === 'string')                   { fullText += parsed.content; continue; }
          if (typeof parsed.delta?.text === 'string')               { fullText += parsed.delta.text; continue; }
        } catch (_) {
          if (raw && !DONE_SENTINELS.has(raw)) fullText += raw;
        }
      }
    });

    stream.on('end', () => {
      const remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        const raw = remaining.slice(5).trim();
        if (raw && !DONE_SENTINELS.has(raw)) {
          try {
            const p = JSON.parse(raw);
            if (typeof p.answer === 'string') fullText += p.answer;
          } catch (_) { fullText += raw; }
        }
      }
      resolve(fullText.trim());
    });

    stream.on('error', reject);
  });
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * @param {string} userMessage
 * @param {string|null} [systemOverride]
 * @returns {Promise<string>}
 */
async function askAI(userMessage, systemOverride = null) {
  const payload = {
    question: userMessage,
    model: config.aiModel,
    systemPrompt: systemOverride || 'Kamu adalah asisten AI yang helpful. Jawab dalam Bahasa Indonesia.',
    saveSession: false
  };

  const response = await axios.post(`${config.aiApiUrl}/api/chat`, payload, {
    headers: { 'Content-Type': 'application/json' },
    responseType: 'stream',
    timeout: 120000
  });

  const text = await parseSSEStream(response.data);
  if (!text) throw new Error('Response AI kosong — coba lagi.');
  return text;
}

// ─── Character Story generator ────────────────────────────────────────────────

/**
 * Build the user prompt for CS generation.
 */
function buildCSPrompt(formData) {
  const { nama, ttl, kota, pekerjaan, sukses, jumlahParagraf } = formData;
  return (
    `Tulis character story untuk karakter bernama ${nama}.\n` +
    `Lahir pada tanggal ${ttl} di Kota ${kota}.\n` +
    `Pekerjaannya sebagai ${pekerjaan}.\n` +
    `Kondisi akhirnya: ${sukses}.\n\n` +
    `Tulis tepat ${jumlahParagraf} paragraf.\n` +
    `Setiap paragraf wajib diawali dengan 3 spasi.\n` +
    `Tiru PERSIS gaya tulisan ambiguitas dari contoh yang sudah diberikan.\n` +
    `Output HANYA paragraf — tidak ada judul, tidak ada markdown, tidak ada simbol apapun.`
  );
}

/**
 * Generate CS with optional retry attempt number (escalates prompt strictness).
 * @param {object} formData
 * @param {number} [attempt=1]
 * @returns {Promise<string>} cleaned plain-text CS
 */
async function generateCharacterStory(formData, attempt = 1) {
  const systemPrompt = attempt <= 1
    ? SYSTEM_PROMPT
    : RETRY_SYSTEM_PROMPTS[Math.min(attempt - 2, RETRY_SYSTEM_PROMPTS.length - 1)];

  const raw = await askAI(buildCSPrompt(formData), systemPrompt);
  return cleanCSText(raw);
}

// ─── Patch highlighted sentences ─────────────────────────────────────────────

/**
 * Ambil kalimat-kalimat yang di-highlight kuning oleh ZeroGPT,
 * lalu minta AI ubah hanya bagian itu ke gaya ambiguitas yang lebih natural.
 * Teks di luar highlighted tetap tidak berubah.
 *
 * @param {string} fullText         - Teks CS lengkap saat ini
 * @param {string[]} highlighted    - Array kalimat yang terdeteksi AI oleh ZeroGPT
 * @returns {Promise<string>}       - Teks CS dengan kalimat highlight sudah diubah
 */
async function patchHighlightedSentences(fullText, highlighted) {
  if (!highlighted || highlighted.length === 0) return fullText;

  const PATCH_SYSTEM = `Kamu adalah editor teks Indonesia yang ahli menulis dengan gaya AMBIGU dan terasa seperti tulisan manusia.
Tugasmu: Ubah kalimat-kalimat yang diberikan agar terasa lebih natural, tidak beraturan seperti manusia asli, dan tidak terdeteksi AI.

ATURAN WAJIB:
- Pertahankan MAKNA dan KONTEKS yang sama
- Buat variasi kalimat: sesekali sangat pendek, sesekali panjang mengalir
- Hindari pola "Subjek + predikat + objek" yang berulang
- Gunakan gaya bercerita oral — seperti orang cerita ke teman
- JANGAN gunakan Markdown, emoji, heading, atau simbol apapun
- Output HANYA kalimat yang sudah diubah, satu per baris sesuai urutan input
- Jumlah baris output HARUS SAMA PERSIS dengan jumlah kalimat input`;

  const highlightedList = highlighted
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

  const userMsg =
    `Ubah ${highlighted.length} kalimat berikut ke gaya lebih human & ambigu:\n\n` +
    `${highlightedList}\n\n` +
    `Output: ${highlighted.length} baris, satu kalimat per baris, tanpa nomor.`;

  const raw = await askAI(userMsg, PATCH_SYSTEM);
  const patchedLines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  // Ganti tiap kalimat highlighted dalam fullText dengan versi yang sudah di-patch
  let patched = fullText;
  highlighted.forEach((original, i) => {
    const replacement = patchedLines[i] || original;
    // Escape special regex chars before replacing
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patched = patched.replace(new RegExp(escaped, 'g'), replacement);
  });

  return cleanCSText(patched);
}

module.exports = { askAI, generateCharacterStory, patchHighlightedSentences };
