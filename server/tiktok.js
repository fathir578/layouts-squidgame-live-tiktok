/**
 * tiktok.js
 * Integrasi dengan TikTok Live menggunakan tiktok-live-connector.
 * Menangani chat (komentar), gift, dan koneksi ke live stream.
 * 
 * Fitur:
 * - Auto-reconnect dengan exponential backoff (5s, 10s, 20s)
 * - Filter komentar "join" untuk masuk game
 * - Forward gift ke giftHandler
 * - Status koneksi ke overlay via socket.io
 */

const { WebcastPushConnection } = require('tiktok-live-connector');
const giftHandler = require('./giftHandler');
const playerManager = require('./playerManager');

// ===================== STATE =====================
let tiktokConnection = null;
let io = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [5000, 10000, 20000]; // 5s, 10s, 20s

// ===================== INITIALIZATION =====================

/**
 * Inisialisasi koneksi ke TikTok Live.
 * @param {Object} socketIO - socket.io instance
 */
function init(socketIO) {
  io = socketIO;
  const tiktokUsername = process.env.TIKTOK_USERNAME;

  if (!tiktokUsername || tiktokUsername === 'username_host_live') {
    console.warn('[TikTok] TIKTOK_USERNAME belum diset di .env. Koneksi TikTok dilewati.');
    console.warn('[TikTok] Set TIKTOK_USERNAME di .env untuk mengaktifkan koneksi TikTok Live.');
    return;
  }

  connectToTikTok(tiktokUsername);
}

/**
 * Buat koneksi baru ke TikTok Live.
 */
function connectToTikTok(username) {
  try {
    console.log(`[TikTok] Menghubungkan ke @${username}...`);

    tiktokConnection = new WebcastPushConnection(username, {
      enableExtendedGiftInfo: true,
      // Opsi tambahan untuk debugging (opsional)
      // processInitialData: false,
      // fetchRoomInfoOnConnect: true
    });

    // Register event listeners
    registerEventListeners();

    // Mulai koneksi
    tiktokConnection.connect()
      .then(state => {
        console.log(`[TikTok] ✅ Terhubung ke live @${username}!`);
        console.log(`[TikTok] Room ID: ${state.roomId}`);

        // Reset reconnect counter
        reconnectAttempts = 0;

        // Emit status ke overlay
        if (io) {
          io.emit('tiktok:status', { status: 'connected' });
        }
      })
      .catch(err => {
        console.error(`[TikTok] ❌ Gagal terhubung:`, err.message);
        handleConnectionError(err);
      });

  } catch (err) {
    console.error(`[TikTok] Error saat membuat koneksi:`, err);
    if (io) {
      io.emit('tiktok:status', { status: 'error', message: err.message });
    }
  }
}

// ===================== EVENT LISTENERS =====================

function registerEventListeners() {
  if (!tiktokConnection) return;

  // ---------- CHAT (Komentar) ----------
  tiktokConnection.on('chat', data => {
    try {
      handleChat(data);
    } catch (err) {
      console.error('[TikTok] Error handling chat:', err);
    }
  });

  // ---------- GIFT ----------
  tiktokConnection.on('gift', data => {
    try {
      handleGift(data);
    } catch (err) {
      console.error('[TikTok] Error handling gift:', err);
    }
  });

  // ---------- MEMBER (Join/Leave) ----------
  tiktokConnection.on('member', data => {
    // Opsional: log saat viewer masuk live
    // console.log(`[TikTok] Member: ${data.nickname}`);
  });

  // ---------- CONNECT ----------
  tiktokConnection.on('connect', () => {
    console.log('[TikTok] ✅ Connected event fired.');
    reconnectAttempts = 0;
    if (io) {
      io.emit('tiktok:status', { status: 'connected' });
    }
  });

  // ---------- DISCONNECT ----------
  tiktokConnection.on('disconnect', () => {
    console.warn('[TikTok] ⚠️ Terputus dari TikTok Live!');
    if (io) {
      io.emit('tiktok:status', { status: 'disconnected' });
    }
    handleDisconnect();
  });

  // ---------- ERROR ----------
  tiktokConnection.on('error', err => {
    console.error('[TikTok] ❌ Error:', err.message);
    if (io) {
      io.emit('tiktok:status', { status: 'error', message: err.message });
    }
  });

  // ---------- ROOM USER STATS ----------
  tiktokConnection.on('roomUser', data => {
    // Opsional: tampilkan jumlah viewer
    // console.log(`[TikTok] Viewers: ${data.viewerCount}`);
  });

  // ---------- LIKE ----------
  tiktokConnection.on('like', data => {
    try {
      handleLike(data);
    } catch (err) {
      console.error('[TikTok] Error handling like:', err);
    }
  });

  // ---------- SOCIAL ----------
  tiktokConnection.on('social', data => {
    // Opsional: handle share/follow
    // console.log(`[TikTok] Social: ${data.nickname} shared the live`);
  });

  // ---------- EMOTE ----------
  tiktokConnection.on('emote', data => {
    // Opsional: handle emotes
    // console.log(`[TikTok] Emote from ${data.nickname}`);
  });

  // ---------- ENVELOPE ----------
  tiktokConnection.on('envelope', data => {
    // Opsional: handle treasure boxes
    // console.log(`[TikTok] Envelope from ${data.nickname}`);
  });

  // ---------- QUESTION NEW ----------
  tiktokConnection.on('questionNew', data => {
    // Opsional: handle poll questions
    // console.log(`[TikTok] Question: ${data.questionText}`);
  });

  // ---------- LINK MIC ARMOR ----------
  tiktokConnection.on('linkMicArmRankingNotification', data => {
    // Opsional: handle link mic
  });

  // ---------- SUBSCRIBE ----------
  tiktokConnection.on('subscribe', data => {
    // Opsional: handle subscribe
    // console.log(`[TikTok] Subscribe from ${data.nickname}`);
  });
}

// ===================== CHAT HANDLER =====================

function handleChat(data) {
  const { uniqueId, nickname, profilePictureUrl, comment } = data;

  // Trim dan lowercase komentar
  const trimmedComment = comment.trim().toLowerCase();

  // Cek apakah komentar adalah "join"
  if (trimmedComment === 'join') {
    console.log(`[TikTok] 📝 ${nickname} ingin join game!`);

    const result = playerManager.addPlayer({
      uniqueId: uniqueId,
      username: nickname,
      avatarUrl: profilePictureUrl
    });

    if (result.error === 'full') {
      // Game penuh, abaikan (tidak emit apa-apa)
      console.log(`[TikTok] ${nickname} ditolak: game penuh.`);
      return;
    }

    if (result.error === 'duplicate') {
      // Sudah join sebelumnya, abaikan
      console.log(`[TikTok] ${nickname} sudah join sebelumnya.`);
      return;
    }

    if (result.waiting) {
      // Game sedang berlangsung, masuk waiting list
      if (io) {
        io.emit('join:waiting', { username: nickname });
      }
      console.log(`[TikTok] ⏳ ${nickname} masuk waiting list.`);
      return;
    }

    // Berhasil join
    if (io) {
      io.emit('player:joined', result);
    }
    console.log(`[TikTok] ✅ ${nickname} berhasil join game!`);
  }
}

// ===================== LIKE HANDLER =====================
/**
 * Handle LIKE/TAP dari viewer TikTok Live.
 * Setiap like membuat pemain bergerak sedikit maju (hanya saat lampu hijau).
 */
function handleLike(data) {
  const { uniqueId, nickname, likeCount } = data;

  // Import gameEngine untuk fungsi moveOnLike
  const gameEngine = require('./gameEngine');

  // likeCount biasanya 1 per tap, tapi bisa lebih untuk multi-tap
  const result = gameEngine.moveOnLike(uniqueId, likeCount || 1);

  if (!result) {
    // Player tidak ditemukan (mungkin belum join)
    return;
  }

  if (result.blocked) {
    // Player tidak bisa bergerak karena lampu merah/state lain
    // Tidak emit apa-apa, abaikan
    return;
  }

  // Emit posisi baru ke overlay
  if (io) {
    io.emit('player:moved', {
      uniqueId: result.player.uniqueId,
      username: result.player.username,
      posisi: result.newPosition,
      finished: result.finished || false,
      likeCount: likeCount || 1
    });

    // Emit state update untuk semua players
    io.emit('state:update', {
      state: gameEngine.getState(),
      players: require('./playerManager').getAllPlayers()
    });
  }

  console.log(`[TikTok] 👍 ${nickname} tap/like! ${result.player.username} move to ${result.newPosition}%`);
}

// ===================== GIFT HANDLER =====================

function handleGift(data) {
  // Hanya proses saat repeatEnd === true (akhir streak)
  // Hindari trigger berkali-kali untuk gift yang sama dalam streak
  if (data.repeatEnd !== true) {
    return;
  }

  console.log(`[TikTok] 🎁 Gift dari ${data.uniqueId}: ${data.giftName}`);

  // Forward ke giftHandler
  giftHandler.handleGift(data, io);
}

// ===================== DISCONNECT & RECONNECT =====================

function handleDisconnect() {
  reconnectAttempts++;

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`[TikTok] ❌ Gagal reconnect setelah ${MAX_RECONNECT_ATTEMPTS} percobaan. Stop retry.`);
    if (io) {
      io.emit('tiktok:status', {
        status: 'error',
        message: `Gagal reconnect setelah ${MAX_RECONNECT_ATTEMPTS} percobaan.`
      });
    }
    return;
  }

  const delay = RECONNECT_DELAYS[reconnectAttempts - 1] || 30000;
  console.log(`[TikTok] 🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dalam ${delay / 1000}s...`);

  setTimeout(() => {
    const tiktokUsername = process.env.TIKTOK_USERNAME;
    if (tiktokUsername && tiktokUsername !== 'username_host_live') {
      connectToTikTok(tiktokUsername);
    }
  }, delay);
}

function handleConnectionError(err) {
  console.error(`[TikTok] Connection error:`, err.message);
  if (io) {
    io.emit('tiktok:status', { status: 'error', message: err.message });
  }
  // Coba reconnect juga
  handleDisconnect();
}

// ===================== PUBLIC API =====================

/**
 * Koneksi manual dari dashboard.
 * @param {string} username - TikTok username (tanpa @)
 */
function manualConnect(username) {
  // Bersihkan @ dari username jika ada
  const cleanUsername = username.replace('@', '').trim();

  if (!cleanUsername) {
    console.error('[TikTok] Username kosong!');
    if (io) {
      io.emit('tiktok:status', { status: 'error', message: 'Username tidak boleh kosong' });
    }
    return;
  }

  // Jika sudah ada koneksi, disconnect dulu
  if (tiktokConnection) {
    console.log('[TikTok] Disconnect koneksi lama sebelum connect ulang...');
    tiktokConnection.disconnect();
    tiktokConnection = null;
  }

  // Update env
  process.env.TIKTOK_USERNAME = cleanUsername;

  console.log(`[TikTok] Connecting to @${cleanUsername}...`);

  if (io) {
    io.emit('tiktok:status', { status: 'connecting', username: cleanUsername });
  }

  connectToTikTok(cleanUsername);
}

/**
 * Disconnect manual dari dashboard.
 */
function manualDisconnect() {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
    tiktokConnection = null;
    reconnectAttempts = 0;
    console.log('[TikTok] Manual disconnect.');
    if (io) {
      io.emit('tiktok:status', { status: 'disconnected', message: 'Disconnected manually' });
    }
  } else {
    console.log('[TikTok] Tidak ada koneksi aktif.');
    if (io) {
      io.emit('tiktok:status', { status: 'disconnected', message: 'Tidak ada koneksi aktif' });
    }
  }
}

/**
 * Dapatkan username TikTok yang sedang digunakan.
 */
function getCurrentUsername() {
  return process.env.TIKTOK_USERNAME || '';
}

/**
 * Dapatkan status koneksi lengkap.
 */
function getConnectionStatus() {
  if (!tiktokConnection) {
    return { connected: false, attempts: reconnectAttempts };
  }
  return { connected: true, attempts: reconnectAttempts };
}

// ===================== EXPORTS =====================
module.exports = {
  init,
  manualConnect,
  manualDisconnect,
  getCurrentUsername,
  getConnectionStatus
};
