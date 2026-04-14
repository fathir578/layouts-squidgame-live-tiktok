# 🎮 TikTok Red Light Green Light Game

Game interaktif TikTok Live dimana viewer bisa bergabung dengan comment "join" dan bermain Red Light Green Light secara real-time!

## 📁 Struktur Project
```
project/
├── server/
│   ├── index.js           # Entry point (Express + Socket.io)
│   ├── gameEngine.js      # State machine game
│   ├── playerManager.js   # Manajemen pemain
│   ├── giftHandler.js     # Handler gift TikTok
│   └── tiktok.js          # Koneksi TikTok Live
├── overlay/
│   ├── index.html         # Game overlay untuk OBS (1920x1080)
│   ├── game.js            # Canvas game logic
│   └── sounds/            # Sound effects (MP3)
└── dashboard/
    └── index.html         # Control panel host
```

## 🚀 Cara Menjalankan

### 1. Setup (Pertama Kali)
```bash
npm install
```

### 2. Konfigurasi .env
Edit file `.env`:
```env
PORT=3000
TIKTOK_USERNAME=username_tiktok_live_kamu
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Jalankan Server
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server akan berjalan di: **http://localhost:3000**

## 🖥️ URLs

| Halaman | URL | Fungsi |
|---------|-----|--------|
| **API Info** | http://localhost:3000 | Info endpoints |
| **Overlay** | http://localhost:3000/overlay/index.html | OBS Browser Source (1920x1080) |
| **Dashboard** | http://localhost:3000/dashboard/index.html | Control panel host |

## 🔧 Debug Endpoints (Testing Tanpa TikTok)

### Tambah Pemain
```bash
curl -X POST http://localhost:3000/debug/join \
  -H "Content-Type: application/json" \
  -d '{"uniqueId":"user1","username":"PlayerOne","avatarUrl":""}'
```

### Trigger Gift
```bash
curl -X POST http://localhost:3000/debug/gift \
  -H "Content-Type: application/json" \
  -d '{"giftName":"Rose","uniqueId":"user1"}'
```

### Lihat State
```bash
curl http://localhost:3000/debug/state
```

### Lihat Semua Pemain
```bash
curl http://localhost:3000/debug/players
```

### Trigger Like (Testing)
```bash
curl -X POST http://localhost:3000/debug/like \
  -H "Content-Type: application/json" \
  -d '{"uniqueId":"user1","likeCount":1}'
```

## 🎮 Cara Main

### Dari TikTok Live:
1. Host buka live TikTok
2. Viewer comment **"join"** untuk masuk game
3. Host klik **"MULAI GAME"** di dashboard
4. Game berjalan otomatis dengan state machine

### Dari Dashboard (Manual):
1. Buka http://localhost:3000/dashboard/index.html
2. Tunggu minimal 2 pemain join
3. Klik tombol kontrol:
   - **MULAI GAME** - Mulai dari LOBBY
   - **RESET GAME** - Kembali ke IDLE
   - **LAMPU HIJAU** - Force green light
   - **LAMPU MERAH** - Force red light
   - **Kick** - Eliminasi pemain manual

### Di OBS:
1. Add **Browser Source**
2. URL: `http://localhost:3000/overlay/index.html`
3. Size: **1920x1080**
4. Custom CSS: (kosongkan)

## 🎁 Gift Effects

| Gift | Efek |
|------|------|
| **Rose** | ❄️ Freeze waktu 5 detik (semua pemain berhenti) |
| **TikTok** | ⚡ Eliminasi 1 pemain random |
| **Lion** | 🦁 Pengirim langsung MENANG |
| **Universe** | 🛡️ Semua pemain selamat 1 ronde |

## 👍 Like/TAP Feature

Viewer bisa **tap/like** di TikTok Live untuk membuat karakternya bergerak maju!

- Setiap like = **+0.3% movement** (base) + bonus dari likeCount
- Hanya bekerja saat **LAMPU HIJAU** 🟢
- Saat lampu merah 🔴, like **tidak berpengaruh** (anti-cheat)
- Multi-tap = lebih banyak movement (max +2.0% per like)
- Efek visual: **Flash orange** di sekitar karakter

### Debug Like:
```bash
curl -X POST http://localhost:3000/debug/like \
  -H "Content-Type: application/json" \
  -d '{"uniqueId":"user1","likeCount":1}'
```

## 🎯 Game Flow

```
IDLE → LOBBY → COUNTDOWN (5..4..3..2..1)
  ↓
GREEN_LIGHT (3-7 detik, pemain jalan)
  ↓
RED_LIGHT (2-5 detik, semua berhenti)
  ↓
CHECKING (cek yang bergerak → eliminasi)
  ↓
ROUND_END
  ├─ Jika >= 2 alive → GREEN_LIGHT lagi
  ├─ Jika 1 alive → GAME OVER (winner)
  └─ Jika 0 alive → GAME OVER (draw)
```

## 🎨 Perspektif Game

**TOP-DOWN** (dari atas):
- Pemain mulai dari bawah (START)
- Bergerak ke atas menuju FINISH
- Stickman dengan foto profil TikTok di kepala
- Setiap pemain punya lane sendiri (max 50 pemain)

## ⚡ Game Speed

Game diperlambat supaya lebih seru:
- **OLD**: `kecepatan * 0.5` per tick (terlalu cepat)
- **NEW**: `kecepatan * 0.15` per tick (lebih lama)
- **LIKE**: +0.3-2.0% per tap (bonus untuk viewer aktif)

Estimasi waktu game:
- Tanpa like: ~3-5 menit per game
- Dengan like aktif: ~2-3 menit (viewer bisa boost)

## 🛠️ Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **TikTok**: tiktok-live-connector
- **Game UI**: HTML5 Canvas (vanilla)
- **Dashboard**: HTML vanilla (no framework)
- **Sound**: Howler.js (MP3 lokal)

## 📝 Catatan Penting

1. **Sound Files**: Pastikan semua file MP3 ada di `overlay/sounds/`:
   - background.mp3 (musik tegang loop)
   - eliminated.mp3, winner.mp3, freeze.mp3
   - thunder.mp3, shield.mp3, countdown.mp3

2. **TikTok Username**: Harus sesuai dengan username akun TikTok yang live

3. **Max Players**: 50 pemain per game

4. **CORS**: Sudah di-set allow all origin (`*`) untuk kemudahan testing

## 🐛 Troubleshooting

### Server tidak bisa start
```bash
# Cek port 3000 apakah sudah dipakai
lsof -i :3000

# Kill process yang占用
kill -9 <PID>
```

### TikTok tidak connect
- Pastikan `TIKTOK_USERNAME` di `.env` sudah benar
- Akun TikTok harus sedang LIVE
- Cek log server untuk error detail

### Overlay tidak muncul di OBS
- Pastikan server jalan di port 3000
- Cek URL Browser Source di OBS
- Custom CSS di OBS harus kosong

### Sound tidak bunyi
- Cek apakah file MP3 ada di `overlay/sounds/`
- Browser harus user-interaction dulu sebelum play sound (klik overlay 1x)

## 📜 License

MIT License - Feel free to modify and use!

---

**Happy Streaming! 🎮🔴**
