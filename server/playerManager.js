/**
 * playerManager.js
 * Mengelola semua data pemain: join, leave, eliminasi, winner, dll.
 * Menggunakan Map untuk penyimpanan in-memory dengan uniqueId sebagai key.
 */

// ===================== CONSTANTS =====================
const MAX_PLAYERS = 150;

// ===================== COLOR GENERATOR =====================
/**
 * Generate warna hex unik dari username.
 * Hash sederhana: jumlah char code modulo panjang array warna.
 */
function generateColor(username) {
  const colors = [
    "#E24B4A", "#1D9E75", "#378ADD",
    "#BA7517", "#534AB7", "#D85A30",
    "#D4537E", "#639922", "#0F6E56",
    "#185FA5", "#993C1D", "#72243E"
  ];
  let hash = 0;
  for (let c of username) {
    hash += c.charCodeAt(0);
  }
  return colors[hash % colors.length];
}

// ===================== STATE INTERNAL =====================
const players = new Map();       // uniqueId → player object
const waitingList = [];          // antrian pemain saat game berlangsung

// Reference ke gameEngine (di-set via init untuk hindari circular dependency)
let _getGameState = () => 'idle'; // default

/**
 * Set reference ke fungsi getState dari gameEngine.
 * Dipanggil sekali saat server start.
 */
function init(getStateFn) {
  _getGameState = getStateFn;
  console.log('[PlayerManager] Initialized with game state reference.');
}

// ===================== PUBLIC API =====================

/**
 * Tambah pemain baru.
 * @param {Object} userData - { uniqueId, username, avatarUrl }
 * @returns {Object} - player object | { waiting: true } | { error: "full" }
 */
function addPlayer(userData) {
  const { uniqueId, username, avatarUrl } = userData;

  try {
    // Cek duplikat: jika sudah ada di Map, skip
    if (players.has(uniqueId)) {
      console.log(`[PlayerManager] ${username} sudah ada di game, skip.`);
      return { error: "duplicate" };
    }

    // Cek apakah sudah ada di waitingList
    const alreadyWaiting = waitingList.find(p => p.uniqueId === uniqueId);
    if (alreadyWaiting) {
      console.log(`[PlayerManager] ${username} sudah ada di waiting list, skip.`);
      return { error: "duplicate" };
    }

    // Cek state game dari reference (bukan dynamic require)
    const gameState = _getGameState();

    // Jika game sedang berlangsung (bukan IDLE/LOBBY), masukkan ke waiting list
    if (gameState !== 'idle' && gameState !== 'lobby') {
      const waitingPlayer = {
        uniqueId,
        username,
        avatarUrl,
        color: generateColor(uniqueId),
        joinedAt: Date.now()
      };
      waitingList.push(waitingPlayer);
      console.log(`[PlayerManager] ${username} masuk waiting list (game sedang berlangsung).`);
      return { waiting: true };
    }

    // Cek max 50 pemain
    if (players.size >= MAX_PLAYERS) {
      console.log(`[PlayerManager] Game penuh (${MAX_PLAYERS} pemain). ${username} ditolak.`);
      return { error: "full" };
    }

    // Buat player object baru
    const player = {
      uniqueId,
      username,
      avatarUrl,
      color: generateColor(uniqueId),
      posisi: parseFloat((Math.random() * 5).toFixed(2)),        // random 0-5
      kecepatan: parseFloat((Math.random() * (2.8 - 1.2) + 1.2).toFixed(2)), // random 1.2-2.8
      posisiSnapshot: 0,
      status: "alive",
      joinedAt: Date.now()
    };

    // Simpan ke Map
    players.set(uniqueId, player);
    console.log(`[PlayerManager] ${username} bergabung! (posisi: ${player.posisi}, kecepatan: ${player.kecepatan})`);

    return { ...player };
  } catch (err) {
    console.error(`[PlayerManager] Error saat menambah pemain ${username}:`, err);
    return { error: "internal_error" };
  }
}

/**
 * Hapus pemain dari game.
 * @param {string} uniqueId
 * @returns {boolean}
 */
function removePlayer(uniqueId) {
  const player = players.get(uniqueId);
  if (player) {
    players.delete(uniqueId);
    console.log(`[PlayerManager] ${player.username} dihapus dari game.`);
    return true;
  }
  return false;
}

/**
 * Ambil data satu pemain berdasarkan uniqueId.
 * @param {string} uniqueId
 * @returns {Object|null}
 */
function getPlayer(uniqueId) {
  return players.get(uniqueId) || null;
}

/**
 * Ambil semua pemain yang masih alive.
 * @returns {Array}
 */
function getAlivePlayers() {
  return Array.from(players.values()).filter(p => p.status === "alive");
}

/**
 * Ambil semua pemain (termasuk eliminated dan winner).
 * @returns {Array}
 */
function getAllPlayers() {
  return Array.from(players.values());
}

/**
 * Ambil waiting list.
 * @returns {Array}
 */
function getWaitingList() {
  return [...waitingList];
}

/**
 * Eliminasi pemain (set status = eliminated).
 * @param {string} uniqueId
 * @param {string} reason - "moved", "gift", "kick"
 * @returns {Object|null} - { player, reason } atau null jika tidak ditemukan
 */
function eliminatePlayer(uniqueId, reason) {
  const player = players.get(uniqueId);
  if (!player) {
    console.warn(`[PlayerManager] eliminatePlayer: ${uniqueId} tidak ditemukan.`);
    return null;
  }

  player.status = "eliminated";
  console.log(`[PlayerManager] ${player.username} dieliminasi! Alasan: ${reason}`);

  return { player, reason };
}

/**
 * Set pemain sebagai winner.
 * @param {string} uniqueId
 * @returns {Object|null} - player object atau null
 */
function setWinner(uniqueId) {
  const player = players.get(uniqueId);
  if (!player) {
    console.warn(`[PlayerManager] setWinner: ${uniqueId} tidak ditemukan.`);
    return null;
  }

  player.status = "winner";
  console.log(`[PlayerManager] 🏆 ${player.username} MENANG!`);

  return { ...player };
}

/**
 * Snapshot posisi semua pemain alive (untuk cek gerakan saat lampu merah).
 */
function snapshotPositions() {
  const alivePlayers = getAlivePlayers();
  alivePlayers.forEach(player => {
    player.posisiSnapshot = player.posisi;
  });
  console.log(`[PlayerManager] Snapshot posisi untuk ${alivePlayers.length} pemain alive.`);
}

/**
 * Ambil pemain yang bergerak saat lampu merah.
 * Bandingkan posisi sekarang vs posisiSnapshot.
 * Toleransi delta <= 0.5 dianggap tidak bergerak (network lag).
 * @returns {Array} - array pemain yang bergerak
 */
function getMovedPlayers() {
  const alivePlayers = getAlivePlayers();
  const moved = [];

  alivePlayers.forEach(player => {
    const delta = player.posisi - player.posisiSnapshot;
    if (delta > 0.5) {
      moved.push(player);
      console.log(`[PlayerManager] ${player.username} bergerak! Delta: ${delta.toFixed(2)}`);
    }
  });

  return moved;
}

/**
 * Promosikan semua waiting list ke players (saat game baru dimulai).
 * @returns {Array} - array pemain yang dipromosikan
 */
function promoteWaiting() {
  if (waitingList.length === 0) {
    return [];
  }

  const promoted = [];
  const waitingCopy = [...waitingList];

  // Kosongkan waitingList dulu
  waitingList.length = 0;

  // Masukkan ke players jika masih ada slot
  for (const wp of waitingCopy) {
    if (players.size >= MAX_PLAYERS) {
      waitingList.push(wp); // kembalikan ke waiting jika penuh
      continue;
    }

    const player = {
      ...wp,
      posisi: parseFloat((Math.random() * 5).toFixed(2)),
      kecepatan: parseFloat((Math.random() * (2.8 - 1.2) + 1.2).toFixed(2)),
      posisiSnapshot: 0,
      status: "alive"
    };

    players.set(player.uniqueId, player);
    promoted.push(player);
    console.log(`[PlayerManager] ${player.username} dipromosikan dari waiting list!`);
  }

  return promoted;
}

/**
 * Reset semua data pemain dan waiting list.
 * @returns {boolean}
 */
function resetAll() {
  console.log(`[PlayerManager] Reset semua data pemain (${players.size} pemain, ${waitingList.length} waiting).`);
  players.clear();
  waitingList.length = 0;
  return true;
}

// ===================== EXPORTS =====================
module.exports = {
  init,
  addPlayer,
  removePlayer,
  getPlayer,
  getAlivePlayers,
  getAllPlayers,
  getWaitingList,
  eliminatePlayer,
  setWinner,
  snapshotPositions,
  getMovedPlayers,
  promoteWaiting,
  resetAll,
  generateColor
};
