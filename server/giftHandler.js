/**
 * giftHandler.js
 * Menangani efek gift dari TikTok Live dengan efek visual yang WOW!
 *
 * Gift effects:
 * MURAH (1-10 koin):
 * - Rose (1 koin)        → Freeze waktu 5 detik + efek salju ❄️
 * - GG (1 koin)          → Confetti kecil 🎮
 * - Love (1 koin)        → Mundurkan 2 pemain ❤️
 * - Coffee (1 koin)      → Speed boost semua pemain ☕
 * - Hey (1 koin)         → Random shuffle posisi 👋
 *
 * MENENGAH (99-200 koin):
 * - TikTok (199 koin)    → Eliminasi 1 pemain random 📱
 * - MoneyGun (99 koin)   → Eliminasi 2 pemain random 🔫
 *
 * MAHAL (2000+ koin):
 * - Paus (2,150 koin)    → TSUNAMI! Eliminasi 3 pemain 🌊
 * - Lion (20,000 koin)   → Langsung menang 🦁
 * - Universe (44,999)    → SHIELD GOLDEN! Semua selamat 1 ronde + cosmic animation 🌌
 */

const gameEngine = require('./gameEngine');
const playerManager = require('./playerManager');
const statsTracker = require('./statsTracker');

/**
 * Handle gift dari TikTok Live.
 * Hanya diproses saat repeatEnd === true (akhir streak).
 *
 * @param {Object} data - gift data dari tiktok-live-connector
 * @param {Object} io   - socket.io instance
 */
function handleGift(data, io) {
  const { uniqueId, giftName, repeatCount } = data;

  try {
    console.log(`[GiftHandler] 🎁 ${uniqueId} mengirim ${giftName} (repeatCount: ${repeatCount})`);

    switch (giftName) {
      case 'Rose':
        handleRose(uniqueId, io);
        break;
      case 'TikTok':
        handleTikTok(uniqueId, io);
        break;
      case 'MoneyGun':
        handleMoneyGun(uniqueId, io);
        break;
      case 'Lion':
        handleLion(uniqueId, io);
        break;
      case 'Universe':
        handleUniverse(uniqueId, io);
        break;
      case 'Paus':
        handlePaus(uniqueId, io);
        break;
      case 'GG':
      case 'Love':
      case 'Coffee':
      case 'Hey':
        handleCheapGift(uniqueId, giftName, io);
        break;
      default:
        // Gift lain diabaikan (tidak punya efek)
        console.log(`[GiftHandler] Gift "${giftName}" tidak memiliki efek.`);
        break;
    }
  } catch (err) {
    console.error(`[GiftHandler] Error handling gift ${giftName}:`, err);
  }
}

// ===================== GIFT: ROSE (Freeze Time) =====================
function handleRose(uniqueId, io) {
  const duration = 5000; // 5 detik
  gameEngine.freeze(duration);
  
  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'Rose', 1);

  const pesan = `${uniqueId} membekukan waktu ${duration / 1000} detik!`;
  console.log(`[GiftHandler] ❄️ ${pesan}`);

  io.emit('gift:effect', {
    type: 'freeze',
    sender: uniqueId,
    durasi: duration / 1000,
    pesan: pesan
  });
}

// ===================== GIFT: TIKTOK (Eliminasi 1 Random) =====================
function handleTikTok(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length === 0) {
    console.log('[GiftHandler] ⚠️ Tidak ada pemain alive untuk dieliminasi oleh gift TikTok.');
    return;
  }
  
  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'TikTok', 199);

  // Pilih korban random
  const korban = alive[Math.floor(Math.random() * alive.length)];
  playerManager.eliminatePlayer(korban.uniqueId, 'gift');

  const pesan = `📱 ${uniqueId} mengeliminasi ${korban.username}!`;
  console.log(`[GiftHandler] 📱 ${pesan}`);

  io.emit('player:eliminated', {
    player: korban,
    reason: 'gift'
  });

  io.emit('gift:effect', {
    type: 'eliminate',
    sender: uniqueId,
    korban: korban,
    pesan: pesan
  });
}

// ===================== GIFT: MONEYGUN (Eliminasi 2 Random) =====================
function handleMoneyGun(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length <= 1) {
    console.log('[GiftHandler] ⚠️ Tidak cukup pemain untuk gift MoneyGun.');
    return;
  }
  
  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'MoneyGun', 99);

  // Eliminasi 2 pemain random (atau semua jika kurang dari 2)
  const countToEliminate = Math.min(2, alive.length - 1);
  const shuffled = [...alive].sort(() => Math.random() - 0.5);
  const victims = shuffled.slice(0, countToEliminate);

  const eliminatedNames = [];
  for (const korban of victims) {
    playerManager.eliminatePlayer(korban.uniqueId, 'gift_moneygun');
    eliminatedNames.push(korban.username);
    
    io.emit('player:eliminated', {
      player: korban,
      reason: 'gift_moneygun'
    });
  }

  const pesan = `🔫 ${uniqueId} menembakkan Money Gun! ${eliminatedNames.length} pemain terhempas: ${eliminatedNames.join(', ')}!`;
  console.log(`[GiftHandler] 🔫 ${pesan}`);

  io.emit('gift:effect', {
    type: 'eliminate',
    sender: uniqueId,
    korban: victims,
    pesan: pesan
  });
}

// ===================== GIFT: LION (Instant Win) =====================
function handleLion(uniqueId, io) {
  const player = playerManager.getPlayer(uniqueId);
  
  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'Lion', 20000);

  // Cek apakah pengirim ikut game dan masih alive
  if (!player || player.status !== 'alive') {
    const pesan = `${uniqueId} kirim Lion tapi tidak ikut game!`;
    console.log(`[GiftHandler] ⚠️ ${pesan}`);

    io.emit('gift:effect', {
      type: 'lion_failed',
      sender: uniqueId,
      pesan: pesan
    });
    return;
  }

  // Pengirim langsung menang
  gameEngine.triggerWin(player);

  const pesan = `${uniqueId} langsung menang karena Lion!`;
  console.log(`[GiftHandler] 🦁 ${pesan}`);

  io.emit('gift:effect', {
    type: 'winner',
    sender: uniqueId,
    pesan: pesan
  });
}

// ===================== GIFT: UNIVERSE (GOLDEN SHIELD - ALL PLAYERS SAFE) =====================
function handleUniverse(uniqueId, io) {
  gameEngine.skipCheck();

  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'Universe', 44999);

  const pesan = `🌌✨ ${uniqueId} mengaktifkan GOLDEN SHIELD! Semua pemain selamat dari eliminasi! ✨🌌`;
  console.log(`[GiftHandler] 🌌 GOLDEN SHIELD! ${pesan}`);

  // Emit dengan special cosmic effect
  io.emit('gift:effect', {
    type: 'universe',
    sender: uniqueId,
    pesan: pesan,
    cosmic: true
  });
}

// ===================== GIFT: PAUS (Eliminasi 3 Pemain Random - SUPER POWER!) =====================
function handlePaus(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length <= 1) {
    console.log('[GiftHandler] ⚠️ Tidak cukup pemain untuk gift Paus.');
    return;
  }
  
  // Record gift stats
  statsTracker.recordGift(uniqueId, uniqueId, 'Paus', 2150);

  // Eliminasi 3 pemain random (atau semua jika kurang dari 3)
  const countToEliminate = Math.min(3, alive.length - 1); // Sisakan minimal 1 pemain
  const shuffled = [...alive].sort(() => Math.random() - 0.5);
  const victims = shuffled.slice(0, countToEliminate);

  const eliminatedNames = [];
  for (const korban of victims) {
    playerManager.eliminatePlayer(korban.uniqueId, 'gift_paus');
    eliminatedNames.push(korban.username);
    
    io.emit('player:eliminated', {
      player: korban,
      reason: 'gift_paus'
    });
  }

  const pesan = `🐋 ${uniqueId} mengaktifkan TSUNAMI! ${eliminatedNames.length} pemain terhempas: ${eliminatedNames.join(', ')}!`;
  console.log(`[GiftHandler] 🐋 TSUNAMI! ${pesan}`);

  io.emit('gift:effect', {
    type: 'eliminate',
    sender: uniqueId,
    korban: victims,
    pesan: pesan
  });
}

// ===================== GIFT MURAH (Cosmetic + Effects) =====================
function handleCheapGift(uniqueId, giftName, io) {
  const giftEmojis = {
    'GG': '🎮',
    'Love': '❤️',
    'Coffee': '☕',
    'Hey': '👋'
  };

  const emoji = giftEmojis[giftName] || '🎁';

  // Love gift: Mundurkan 2 pemain random
  if (giftName === 'Love') {
    handleLove(uniqueId, io);
    return;
  }

  // Coffee gift: Speed boost semua pemain sedikit
  if (giftName === 'Coffee') {
    handleCoffee(uniqueId, io);
    return;
  }

  // Hey gift: Random shuffle posisi pemain
  if (giftName === 'Hey') {
    handleHey(uniqueId, io);
    return;
  }

  // GG gift: Confetti kecil + notification
  const pesan = `${emoji} ${uniqueId} mengirim ${giftName}! Semangat!`;
  console.log(`[GiftHandler] ${pesan}`);

  io.emit('gift:effect', {
    type: 'confetti',
    sender: uniqueId,
    giftName: giftName,
    emoji: emoji,
    pesan: pesan
  });
}

// ===================== GIFT: LOVE (Mundurkan 2 Pemain Random) =====================
function handleLove(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length === 0) {
    console.log('[GiftHandler] ⚠️ Tidak ada pemain alive untuk gift Love.');
    return;
  }

  // Pilih 2 pemain random untuk dimundurkan
  const countToPush = Math.min(2, alive.length);
  const shuffled = [...alive].sort(() => Math.random() - 0.5);
  const victims = shuffled.slice(0, countToPush);

  const pushedNames = [];
  for (const player of victims) {
    // Mundurkan 10% (minimal 5%)
    const pushAmount = Math.max(5, player.posisi * 0.10);
    const oldPos = player.posisi;
    player.posisi = parseFloat(Math.max(0, player.posisi - pushAmount).toFixed(2));
    pushedNames.push(`${player.username} (${oldPos}% → ${player.posisi}%)`);
  }

  const pesan = `❤️ ${uniqueId} mengirim Love! ${pushedNames.length} pemain mundur: ${pushedNames.join(', ')}!`;
  console.log(`[GiftHandler] ❤️ ${pesan}`);

  // Emit state update dengan posisi baru
  io.emit('state:update', {
    state: gameEngine.getState(),
    players: playerManager.getAllPlayers(),
    finishedCount: gameEngine.getTimer().finishedCount,
    maxFinish: gameEngine.getTimer().maxFinish
  });

  io.emit('gift:effect', {
    type: 'push_back',
    sender: uniqueId,
    korban: victims,
    pesan: pesan
  });
}

// ===================== GIFT: COFFEE (Speed Boost Semua Pemain) =====================
function handleCoffee(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length === 0) {
    console.log('[GiftHandler] ⚠️ Tidak ada pemain alive untuk gift Coffee.');
    return;
  }

  // Boost semua pemain maju 3-8%
  const boostedNames = [];
  for (const player of alive) {
    const boostAmount = 3 + Math.random() * 5;  // 3-8%
    const oldPos = player.posisi;
    player.posisi = parseFloat(Math.min(100, player.posisi + boostAmount).toFixed(2));
    
    // Cek jika ada yang finish
    if (player.posisi >= 100) {
      player.posisi = 100;
    }
    
    boostedNames.push(`${player.username} (+${boostAmount.toFixed(1)}%)`);
  }

  const pesan = `☕ ${uniqueId} mengirim Coffee! Semua pemain semangat: ${boostedNames.length} boost!`;
  console.log(`[GiftHandler] ☕ ${pesan}`);

  // Emit state update dengan posisi baru
  io.emit('state:update', {
    state: gameEngine.getState(),
    players: playerManager.getAllPlayers(),
    finishedCount: gameEngine.getTimer().finishedCount,
    maxFinish: gameEngine.getTimer().maxFinish
  });

  io.emit('gift:effect', {
    type: 'speed_boost',
    sender: uniqueId,
    korban: boostedNames,
    pesan: pesan
  });
}

// ===================== GIFT: HEY (Random Shuffle Posisi) =====================
function handleHey(uniqueId, io) {
  const alive = playerManager.getAlivePlayers();

  if (alive.length < 2) {
    console.log('[GiftHandler] ⚠️ Tidak cukup pemain untuk gift Hey.');
    return;
  }

  // Shuffle posisi random
  const positions = alive.map(p => p.posisi);
  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  // Assign shuffled positions
  const shuffledNames = [];
  for (let i = 0; i < alive.length; i++) {
    const oldPos = alive[i].posisi;
    alive[i].posisi = parseFloat(positions[i].toFixed(2));
    shuffledNames.push(`${alive[i].username} (${oldPos}% → ${alive[i].posisi}%)`);
  }

  const pesan = `👋 ${uniqueId} mengirim Hey! Posisi diacak: ${shuffledNames.length} pemain!`;
  console.log(`[GiftHandler] 👋 ${pesan}`);

  // Emit state update dengan posisi baru
  io.emit('state:update', {
    state: gameEngine.getState(),
    players: playerManager.getAllPlayers(),
    finishedCount: gameEngine.getTimer().finishedCount,
    maxFinish: gameEngine.getTimer().maxFinish
  });

  io.emit('gift:effect', {
    type: 'shuffle',
    sender: uniqueId,
    korban: shuffledNames,
    pesan: pesan
  });
}

// ===================== EXPORTS =====================
module.exports = {
  handleGift
};
