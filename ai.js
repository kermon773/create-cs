const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const config = require('./config.json');

// ─── Load ambiguitas data (realtime reference) ────────────────────────────────
// Dibaca sekali saat startup, berisi contoh teks + kata kunci ambiguitas
const ambiguitas = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'ambiguitas.json'), 'utf-8')
);

// Ambil semua contoh teks yang tersedia dari ambiguitas.json
const CONTOH_TEKS_LIST = ambiguitas.contoh_teks.map(c => c.teks);
const KATA_KUNCI       = ambiguitas.kata_kunci_ambiguitas;

// ─── Base rules (dipakai di semua prompt) ─────────────────────────────────────
const BASE_RULES = `
LARANGAN KERAS:
- DILARANG format Markdown: tidak boleh ada #, **, *, __, --, >, \`, atau tag HTML
- DILARANG emoji di dalam teks
- DILARANG judul/heading atau bullet point
- Output HANYA paragraf teks murni

FORMAT:
- Setiap paragraf diawali tepat 3 spasi
- Antar paragraf dipisahkan 1 baris kosong
- Tidak ada teks sebelum paragraf pertama atau sesudah paragraf terakhir

GAYA BAHASA (ambiguitas):
- Kalimat bisa diartikan lebih dari satu cara — jangan pernah eksplisit
- Gunakan metafora kegiatan sehari-hari sebagai "layar"
- Batas antara pekerjaan resmi dan hal lain harus selalu "kabur"
- Kalimat bervariasi: pendek-panjang tidak terduga seperti manusia
- Akhiri dengan kalimat yang tidak memberi kesimpulan pasti
- Bahasa Indonesia natural, mengalir, terasa tulisan manusia
- Hindari pola "Subjek + predikat + objek" yang terlalu berulang`;

// ─── System prompt utama (dengan semua contoh dari ambiguitas.json) ───────────
function buildMainSystemPrompt() {
  const contohBlocks = CONTOH_TEKS_LIST
    .map((teks, i) => `[CONTOH ${i + 1}]\n${teks}`)
    .join('\n\n');

  const kataKunci = KATA_KUNCI.map((k, i) => `${i + 1}. "${k}"`).join('\n');

  return `Kamu adalah penulis cerita karakter roleplay Indonesia.
Tulis Character Story dengan gaya AMBIGU, terasa 100% ditulis manusia, dan tidak terdeteksi AI detector.

ANALISIS & TIRU GAYA INI PERSIS:
${contohBlocks}

KATA KUNCI AMBIGUITAS YANG WAJIB MUNCUL (pilih minimal 3-4):
${kataKunci}
${BASE_RULES}`;
}

// ─── System prompt patch (untuk ubah kalimat highlight kuning) ────────────────
function buildPatchSystemPrompt() {
  // Pakai contoh pertama sebagai referensi gaya
  return `Kamu adalah editor teks Indonesia.
Tugas: ubah kalimat-kalimat berikut agar terasa 100% ditulis manusia, tidak terdeteksi AI.

REFERENSI GAYA YANG HARUS DITIRU:
${CONTOH_TEKS_LIST[0]}

ATURAN:
- Pertahankan MAKNA dan KONTEKS yang sama, hanya ubah cara penyampaiannya
- Variasikan panjang kalimat: kadang pendek saja, kadang mengalir panjang
- Mulai kalimat dari sudut yang tidak terduga — jangan selalu dari subjek
- Gaya bercerita oral, seperti orang cerita ke teman dekat
- JANGAN gunakan Markdown, emoji, atau simbol apapun
- Output: HANYA kalimat yang sudah diubah, satu per baris, tanpa nomor, tanpa penjelasan
- Jumlah baris output HARUS SAMA PERSIS dengan jumlah kalimat input`;
}

// ─── Markdown stripper ────────────────────────────────────────────────────────
function cleanCSText(raw) {
  return raw
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1')
    .replace(/```[\s\S]*?```/g, '').replace(/`(.+?)`/g, '$1')
    .replace(/^(-{3,}|={3,}|\*{3,})$/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '').replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+\s*/gmu, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── SSE parser ───────────────────────────────────────────────────────────────
const DONE_SENTINELS = new Set(["[DONE]", "'[DONE]'", '"[DONE]"', "data: [DONE]"]);

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
          if (typeof parsed.answer === 'string')               { fullText += parsed.answer; continue; }
          if (parsed.choices?.[0]?.delta?.content)             { fullText += parsed.choices[0].delta.content; continue; }
          if (parsed.choices?.[0]?.message?.content)           { fullText += parsed.choices[0].message.content; continue; }
          if (typeof parsed.text === 'string')                 { fullText += parsed.text; continue; }
          if (typeof parsed.content === 'string')              { fullText += parsed.content; continue; }
          if (typeof parsed.delta?.text === 'string')          { fullText += parsed.delta.text; continue; }
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
          try { const p = JSON.parse(raw); if (typeof p.answer === 'string') fullText += p.answer; }
          catch (_) { fullText += raw; }
        }
      }
      resolve(fullText.trim());
    });

    stream.on('error', reject);
  });
}

// ─── API call ─────────────────────────────────────────────────────────────────
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
// Generasi langsung 1 request (instant) dengan analisis semua contoh ambiguitas.json
// Tidak ada perulangan escalating — cukup satu prompt lengkap yang sudah optimal

function buildCSPrompt(formData) {
  const { nama, ttl, kota, pekerjaan, sukses, jumlahParagraf } = formData;
  return (
    `Karakter: ${nama}\n` +
    `Lahir: ${ttl} di ${kota}\n` +
    `Pekerjaan: ${pekerjaan}\n` +
    `Kondisi akhir: ${sukses}\n\n` +
    `Tulis tepat ${jumlahParagraf} paragraf.\n` +
    `Setiap paragraf diawali 3 spasi.\n` +
    `Tiru PERSIS gaya ambiguitas dari semua contoh yang diberikan.\n` +
    `Output HANYA paragraf — tidak ada judul, markdown, simbol.`
  );
}

/**
 * Generate CS — satu call, langsung optimal.
 * MAIN_SYSTEM_PROMPT sudah memuat semua contoh ambiguitas.json secara realtime.
 */
async function generateCharacterStory(formData) {
  const raw = await askAI(buildCSPrompt(formData), buildMainSystemPrompt());
  return cleanCSText(raw);
}

// ─── Patch highlighted sentences ─────────────────────────────────────────────
/**
 * Ubah hanya kalimat-kalimat highlight kuning dari ZeroGPT.
 * Teks di luar highlighted tidak disentuh → jauh lebih cepat daripada full rewrite.
 *
 * @param {string}   fullText    - Teks CS lengkap
 * @param {string[]} highlighted - Kalimat yang terdeteksi AI (highlight kuning ZeroGPT)
 * @returns {Promise<string>}
 */
async function patchHighlightedSentences(fullText, highlighted) {
  if (!highlighted || highlighted.length === 0) return fullText;

  const patchSystem = buildPatchSystemPrompt();

  // Kirim semua kalimat sekaligus dalam satu request
  const userMsg =
    `Ubah ${highlighted.length} kalimat ini ke gaya lebih human & ambigu:\n\n` +
    highlighted.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\nOutput: ${highlighted.length} baris tanpa nomor, satu kalimat per baris.`;

  const raw = await askAI(userMsg, patchSystem);

  // Parse output: satu baris = satu kalimat pengganti
  const patchedLines = raw
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()) // buang nomor kalau AI nekat kasih
    .filter(Boolean);

  // Replace setiap kalimat highlighted dengan versi baru
  let patched = fullText;
  highlighted.forEach((original, i) => {
    const replacement = patchedLines[i] || original;
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patched = patched.replace(new RegExp(escaped, 'g'), replacement);
  });

  return cleanCSText(patched);
}

module.exports = { askAI, generateCharacterStory, patchHighlightedSentences };
