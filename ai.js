const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const config = require('./config.json');

// ─── Load ambiguitas data (realtime reference) ────────────────────────────────
const ambiguitas = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'ambiguitas.json'), 'utf-8')
);

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

// ─── System prompt utama ──────────────────────────────────────────────────────
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

// ─── System prompt patch (context-aware) ─────────────────────────────────────
// Strategi baru: kirim TEKS PENUH dengan tanda [[UBAH:...]] pada kalimat highlight.
// AI bisa lihat kalimat sebelum & sesudah → hasil patch nyambung secara alami.
function buildPatchSystemPrompt() {
  return `Kamu adalah editor teks Indonesia ahli yang bertugas memperbaiki kalimat terdeteksi AI.

Kamu akan menerima TEKS LENGKAP yang mengandung tanda [[UBAH: ...]].
Tanda itu menandai kalimat yang terdeteksi sebagai AI oleh ZeroGPT dan HARUS diubah.

TUGASMU:
- Ubah HANYA kalimat di dalam tanda [[UBAH: ...]] menjadi versi yang natural, ambigu, dan tidak terdeteksi AI
- Gunakan kalimat di SEKITAR tanda (konteks sebelum & sesudah) supaya kalimat baru nyambung dengan alur cerita
- Kalimat di LUAR tanda [[UBAH: ...]] → SIMPAN PERSIS SAMA, tidak boleh ada perubahan satu kata pun
- Kembalikan SELURUH TEKS — tanda [[UBAH: ...]] harus HILANG dari output (sudah diganti kalimat baru)

REFERENSI GAYA:
${CONTOH_TEKS_LIST[0]}

ATURAN TAMBAHAN:
- Variasikan panjang kalimat: kadang sangat pendek, kadang mengalir panjang
- Mulai kalimat dari sudut tidak terduga — hindari selalu mulai dari subjek
- Gaya bercerita oral — seperti cerita ke teman dekat
- DILARANG: Markdown, emoji, simbol apapun, heading, bullet
- Output format: paragraf murni, sama persis struktur aslinya`;
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
    // Bersihkan tanda [[UBAH:...]] jika AI tidak menghilangkannya
    .replace(/\[\[UBAH:\s*([\s\S]*?)\]\]/g, '$1')
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
function buildCSPrompt(formData) {
  const { nama, ttl, kota, pekerjaan, jumlahParagraf } = formData;
  return (
    `Karakter: ${nama}\n` +
    `Lahir: ${ttl} di ${kota}\n` +
    `Pekerjaan: ${pekerjaan}\n\n` +
    `WAJIB: Sebutkan profesi "${pekerjaan}" minimal SATU KALI di dalam cerita dengan huruf kapital di awal kata.\n\n` +
    `Tulis tepat ${jumlahParagraf} paragraf.\n` +
    `Setiap paragraf diawali 3 spasi.\n` +
    `Tiru PERSIS gaya ambiguitas dari semua contoh yang diberikan.\n` +
    `Output HANYA paragraf — tidak ada judul, markdown, simbol.`
  );
}

async function generateCharacterStory(formData) {
  const raw = await askAI(buildCSPrompt(formData), buildMainSystemPrompt());
  return cleanCSText(raw);
}

// ─── Patch highlighted sentences (context-aware, 1 request) ──────────────────
/**
 * Strategi baru — context-aware patching:
 *
 * 1. Tandai setiap kalimat highlight di dalam teks penuh dengan [[UBAH: ...]]
 * 2. Kirim TEKS PENUH + tanda ke AI dalam 1 request
 * 3. AI bisa lihat kalimat SEBELUM & SESUDAH setiap highlight → hasil patch nyambung
 * 4. AI kembalikan teks penuh, tanda [[UBAH:...]] sudah hilang (terganti kalimat baru)
 * 5. Kalimat non-highlight disimpan persis — AI diinstruksikan tidak menyentuhnya
 *
 * Keunggulan vs pendekatan lama (replace per kalimat):
 * - Kalimat patch alur & koherensinya terjaga (AI tahu konteks sekitar)
 * - Tidak ada risiko regex replace gagal karena teks berubah terlalu banyak
 * - Satu API call saja → lebih cepat
 *
 * @param {string}   fullText    - Teks CS lengkap
 * @param {string[]} highlighted - Kalimat yang terdeteksi AI (highlight kuning ZeroGPT)
 * @returns {Promise<string>}
 */
async function patchHighlightedSentences(fullText, highlighted) {
  if (!highlighted || highlighted.length === 0) return fullText;

  // ── Step 1: Tandai kalimat highlight di dalam teks penuh ─────────────────
  let markedText = fullText;
  let markedCount = 0;

  for (const sentence of highlighted) {
    const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    if (regex.test(markedText)) {
      // Gunakan format [[UBAH: ...]] — mudah dibaca AI, mudah di-strip kalau terlewat
      markedText = markedText.replace(new RegExp(escaped, 'g'), `[[UBAH: ${sentence}]]`);
      markedCount++;
    }
  }

  // Tidak ada kalimat yang berhasil ditandai (teks sudah berubah dari iterasi sebelumnya)
  if (markedCount === 0) {
    console.warn('[PATCH] Tidak ada kalimat highlight yang cocok di teks — skip patch.');
    return fullText;
  }

  console.log(`[PATCH] ${markedCount}/${highlighted.length} kalimat berhasil ditandai [[UBAH:...]] di teks.`);
  console.log(`[PATCH] Mengirim teks penuh (${markedText.length} karakter) ke AI untuk patch context-aware...`);

  // ── Step 2: Kirim teks penuh + tanda ke AI — 1 request saja ──────────────
  const userMsg =
    `Berikut adalah teks Character Story yang mengandung tanda [[UBAH: ...]].\n` +
    `Kalimat di dalam tanda itu terdeteksi sebagai AI dan HARUS diubah.\n` +
    `Kalimat di luar tanda → SIMPAN PERSIS, jangan ubah satu kata pun.\n` +
    `Tanda [[UBAH: ...]] harus hilang dari output — gantikan dengan kalimat baru yang natural.\n\n` +
    `TEKS:\n${markedText}`;

  const raw = await askAI(userMsg, buildPatchSystemPrompt());

  console.log(`[PATCH] AI selesai. Membersihkan & mengembalikan teks...`);

  // cleanCSText sudah ada fallback strip [[UBAH:...]] jika AI tidak menghilangkannya
  return cleanCSText(raw);
}

module.exports = { askAI, generateCharacterStory, patchHighlightedSentences };
