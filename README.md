# Discord CS Bot

Bot Discord untuk membuat Character Story otomatis menggunakan Claude Sonnet, dengan pengecekan ZeroGPT.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Buat file `.env`
Copy dari `.env.example`:
```bash
cp .env.example .env
```

Isi nilai berikut di `.env`:
```env
DISCORD_TOKEN=token_bot_discord_kamu
PREFIX=%
AI_API_URL=https://arnaru-ai.vercel.app
AI_MODEL=claude-sonnet-4-6
ZEROGPT_API_KEY=api_key_zerogpt_kamu   # opsional
```

> **ZEROGPT_API_KEY** didapat dari [zerogpt.com](https://www.zerogpt.com) → Settings → API.  
> Jika kosong, cek ZeroGPT akan di-skip dan CS tetap dikirim.

### 3. Jalankan bot
```bash
npm start
# atau development mode:
npm run dev
```

---

## Commands

| Command | Deskripsi |
|---------|-----------|
| `%ai <pertanyaan>` | Tanya AI apapun |
| `%cr-cs` | Kirim embed + tombol Create CS |
| `%help` | Tampilkan daftar command |

---

## Alur `%cr-cs`

```
User ketik %cr-cs
    ↓
Bot kirim Embed + Tombol "✍️ Create CS"
    ↓
User klik tombol
    ↓
Muncul Modal Form:
  • Nama Character IC
  • Tempat, Tanggal Lahir
  • Pekerjaan
  • Jumlah Paragraf & Status (misal: "4, sukses")
    ↓
User submit form
    ↓
Claude Sonnet generate CS (gaya ambiguitas)
    ↓
Cek ke ZeroGPT API
  → 0% AI → ✅ Kirim ke user
  → >0% AI → 🔄 Regenerate (max 3x)
    ↓
Kirim file "Character Story - Nama.txt" ke user (ephemeral)
```

---

## Struktur File

```
create-cs/
├── index.js              ← Entry point bot
├── ai.js                 ← Helper AI (arnaru-ai API)
├── config.json           ← Konfigurasi bot
├── ambiguitas.json       ← Referensi gaya teks ambiguitas
├── commands/
│   └── cr-cs.js          ← Logic command %cr-cs + modal + CS generator
├── utils/
│   └── zerogpt.js        ← ZeroGPT checker
├── .env.example          ← Template environment variables
└── package.json
```

---

## Contoh Isi Form

| Field | Contoh |
|-------|--------|
| Nama Character IC | `Tomas Ferrant` |
| Tempat, Tanggal Lahir | `Los Santos, 12 Januari 2000` |
| Pekerjaan | `Petani dan Peternak` |
| Paragraf & Status | `4, sukses` atau `3, tidak sukses` |
