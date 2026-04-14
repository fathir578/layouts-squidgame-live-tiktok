/**
 * gameEngine.js
 * State machine utama untuk game Red Light Green Light.
 * Mengatur transisi state, game loop, dan komunikasi dengan overlay via Socket.io.
 * 
 * State flow:
 * IDLE → LOBBY → COUNTDOWN → GREEN_LIGHT → RED_LIGHT → CHECKING → ROUND_END → (GREEN_LIGHT atau GAME_OVER)
 */

// ===================== IMPORTS =====================
const playerManager = require('./playerManager');
const statsTracker = require('./statsTracker');

// ===================== STATE CONSTANTS =====================
const STATES = {
  IDLE: 'idle',
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  GREEN_LIGHT: 'green_light',
  RED_LIGHT: 'red_light',
  CHECKING: 'checking',
  ROUND_END: 'round_end',
  GAME_OVER: 'game_over'
};

// ===================== ENGINE STATE =====================
let currentState = STATES.IDLE;
let currentRound = 0;
let gameLoop = null;          // interval untuk movement tick
let skipNextCheck = false;    // flag untuk skip checking (gift Universe)
let frozenUntil = 0;          // timestamp sampai kapan pemain dibekukan (gift Rose)
let io = null;                // socket.io instance
let finishedCount = 0;        // jumlah pemain yang sudah finish
let gameStartTime = 0;        // timestamp game dimulai (untuk timer)
let finishedPlayers = new Set(); // Track pemain yang sudah finish (mencegah duplikat)

// Konstanta: setelah 10 pemain pertama finish, eliminasi sisanya
const MAX_FINISH = 10;

// Konstanta: batas waktu game (3 menit = 180 detik)
const MAX_GAME_TIME = 180;

// Timeout references (untuk bisa di-clear saat reset)
let activeTimeouts = [];

/**
 * Helper: tambah timeout ke tracking agar bisa di-clear saat reset.
 */
function trackedTimeout(fn, delay) {
  const t = setTimeout(() => {
    // hapus dari list setelah selesai
    activeTimeouts = activeTimeouts.filter(x => x !== t);
    fn();
  }, delay);
  activeTimeouts.push(t);
  return t;
}

// ===================== STATE TRANSITIONS =====================

/**
 * Transisi ke state baru dan panggil onEnter.
 */
function transitionTo(newState) {
  console.log(`[GameEngine] Transisi: ${currentState} → ${newState}`);
  currentState = newState;
  onEnter(newState);
}

/**
 * onEnter handler untuk tiap state.
 */
function onEnter(state) {
  try {
    switch (state) {
      case STATES.IDLE:
        onEnterIdle();
        break;
      case STATES.LOBBY:
        onEnterLobby();
        break;
      case STATES.COUNTDOWN:
        onEnterCountdown();
        break;
      case STATES.GREEN_LIGHT:
        onEnterGreenLight();
        break;
      case STATES.RED_LIGHT:
        onEnterRedLight();
        break;
      case STATES.CHECKING:
        onEnterChecking();
        break;
      case STATES.ROUND_END:
        onEnterRoundEnd();
        break;
      case STATES.GAME_OVER:
        onEnterGameOver();
        break;
    }
  } catch (err) {
    console.error(`[GameEngine] Error di onEnter(${state}):`, err);
  }
}

// ===================== STATE: IDLE =====================
function onEnterIdle() {
  // Bersihkan game loop dan timeouts
  stopGameLoop();
  clearAllTimeouts();

  // Reset semua data pemain
  playerManager.resetAll();

  // Reset flags
  currentRound = 0;
  skipNextCheck = false;
  frozenUntil = 0;
  finishedCount = 0;
  finishedPlayers.clear();  // Reset finished players tracking
  gameStartTime = 0;

  // Emit ke overlay
  if (io) {
    io.emit('state:update', { state: 'idle', players: [] });
  }
  console.log('[GameEngine] State IDLE — menunggu game dimulai.');
}

// ===================== STATE: LOBBY =====================
function onEnterLobby() {
  // Promosikan waiting list ke players
  const promoted = playerManager.promoteWaiting();
  if (promoted.length > 0 && io) {
    promoted.forEach(p => {
      io.emit('player:joined', p);
    });
  }

  if (io) {
    io.emit('state:update', {
      state: 'lobby',
      players: playerManager.getAllPlayers()
    });
  }
  console.log(`[GameEngine] State LOBBY — ${playerManager.getAllPlayers().length} pemain terdaftar.`);
}

// ===================== STATE: COUNTDOWN =====================
function onEnterCountdown() {
  // Cek minimal 2 pemain
  const alive = playerManager.getAlivePlayers();
  if (alive.length < 2) {
    console.warn('[GameEngine] Pemain kurang dari 2, kembali ke LOBBY.');
    transitionTo(STATES.LOBBY);
    return;
  }

  let count = 5;

  if (io) {
    io.emit('state:update', {
      state: 'countdown',
      players: playerManager.getAllPlayers(),
      elapsed: 0
    });
    io.emit('countdown', { angka: count });
  }
  console.log(`[GameEngine] Countdown dimulai: ${count}`);

  const countInterval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(countInterval);
      // Countdown selesai → GREEN_LIGHT
      transitionTo(STATES.GREEN_LIGHT);
      return;
    }

    if (io) {
      io.emit('countdown', { angka: count });
    }
    console.log(`[GameEngine] Countdown: ${count}`);
  }, 1000);

  // Track interval untuk cleanup
  activeTimeouts.push(countInterval);
}

// ===================== STATE: GREEN_LIGHT =====================
function onEnterGreenLight() {
  // Durasi random 3000-7000ms — VARIASI LEBIH BESAR
  const duration = Math.floor(Math.random() * (7000 - 2000 + 1)) + 2000;

  if (io) {
    io.emit('state:update', {
      state: 'green_light',
      players: playerManager.getAllPlayers()
    });
  }
  console.log(`[GameEngine] 🟢 LAMPU HIJAU (${duration}ms)`);

  // Mulai game loop: update posisi tiap 100ms — DIPERLAMBAT supaya game lebih lama
  gameLoop = setInterval(() => {
    // CEK WAKTU GAME - jika habis, eliminasi semua yang belum finish
    const elapsed = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
    if (elapsed >= MAX_GAME_TIME) {
      console.log(`[GameEngine] ⏰ WAKTU HABIS (${MAX_GAME_TIME}s)! Eliminasi semua pemain yang belum finish...`);
      eliminateRemaining();
      transitionTo(STATES.GAME_OVER);
      return;
    }

    const alivePlayers = playerManager.getAlivePlayers();

    for (const player of alivePlayers) {
      // Cek apakah pemain sedang dibekukan
      if (Date.now() < frozenUntil) {
        continue; // skip movement
      }

      // Gerakkan pemain ke atas — FAKTOR 0.08 (dari 0.15) agar jauh lebih lambat
      player.posisi = parseFloat((player.posisi + player.kecepatan * 0.08).toFixed(2));

      // Cek apakah sudah sampai finish (HANYA sekali per pemain!)
      if (player.posisi >= 100 && !finishedPlayers.has(player.uniqueId)) {
        // Tandai player sudah finish
        finishedPlayers.add(player.uniqueId);

        finishedCount++;
        const rank = finishedCount;
        console.log(`[GameEngine] 🏆 ${player.username} mencapai FINISH! (Posisi #${rank})`);

        // Record stats untuk pemenang
        if (rank === 1) {
          statsTracker.recordWinner(player.uniqueId, player.username);
        } else if (rank === 2) {
          statsTracker.recordRunnerUp(player.uniqueId, player.username);
        } else if (rank === 3) {
          statsTracker.recordThirdPlace(player.uniqueId, player.username);
        } else {
          // Rank 4+ dapat poin finish
          const finishPoints = Math.max(10, 50 - (rank * 5));
          statsTracker.addPoints(player.uniqueId, finishPoints, `finish_rank_${rank}`);
        }

        // Jika sudah mencapai batas finish, eliminasi semua yang belum finish
        if (finishedCount >= MAX_FINISH) {
          console.log(`[GameEngine] Batas ${MAX_FINISH} pemain tercapai! Eliminasi sisa pemain...`);
          eliminateRemaining();
          transitionTo(STATES.GAME_OVER);
          return;
        }

        // Emit notifikasi finish ke overlay (BUKAN winner - cuma yang finish duluan)
        if (io) {
          io.emit('player:finished', {
            uniqueId: player.uniqueId,
            username: player.username,
            rank: rank
          });
        }
        return;
      }
    }

    // Emit posisi terbaru ke overlay — kirim SEMUA pemain (alive + eliminated)
    if (io) {
      const elapsed = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
      io.emit('state:update', {
        state: 'green_light',
        players: playerManager.getAllPlayers(),
        finishedCount: finishedCount,
        maxFinish: MAX_FINISH,
        elapsed: elapsed,
        timeRemaining: Math.max(0, MAX_GAME_TIME - elapsed)
      });
    }
  }, 100);

  // Setelah durasi habis → RED_LIGHT
  trackedTimeout(() => {
    transitionTo(STATES.RED_LIGHT);
  }, duration);
}

// ===================== STATE: RED_LIGHT =====================
function onEnterRedLight() {
  // Hentikan game loop
  stopGameLoop();

  // Snapshot posisi semua pemain alive
  playerManager.snapshotPositions();

  // Durasi random 2000-6000ms — VARIASI LEBIH BESAR
  const duration = Math.floor(Math.random() * (6000 - 1500 + 1)) + 1500;

  if (io) {
    const elapsed = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
    io.emit('state:update', {
      state: 'red_light',
      players: playerManager.getAllPlayers(),
      finishedCount: finishedCount,
      maxFinish: MAX_FINISH,
      elapsed: elapsed,
      timeRemaining: Math.max(0, MAX_GAME_TIME - elapsed)
    });
  }
  console.log(`[GameEngine] 🔴 LAMPU MERAH (${duration}ms) — BERHENTI!`);

  // Setelah durasi habis → CHECKING
  trackedTimeout(() => {
    transitionTo(STATES.CHECKING);
  }, duration);
}

// ===================== STATE: CHECKING =====================
function onEnterChecking() {
  // Cek apakah skip check aktif (dari gift Universe)
  if (skipNextCheck) {
    skipNextCheck = false;
    console.log('[GameEngine] CHECKING dilewati (gift Universe).');

    if (io) {
      io.emit('state:update', {
        state: 'checking',
        eliminated: [],
        skipped: true,
        players: playerManager.getAllPlayers()
      });
    }

    trackedTimeout(() => {
      transitionTo(STATES.ROUND_END);
    }, Math.random() * (1500 - 500) + 500);
    return;
  }

  // Cek pemain yang bergerak
  const moved = playerManager.getMovedPlayers();

  // Eliminasi semua yang bergerak
  for (const player of moved) {
    playerManager.eliminatePlayer(player.uniqueId, 'moved');
    if (io) {
      io.emit('player:eliminated', { player, reason: 'moved' });
    }
  }

  if (io) {
    io.emit('state:update', {
      state: 'checking',
      eliminated: moved,
      safe: playerManager.getAlivePlayers(),
      players: playerManager.getAllPlayers(),
      finishedCount: finishedCount,
      maxFinish: MAX_FINISH,
      elapsed: gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0
    });
  }
  console.log(`[GameEngine] CHECKING — ${moved.length} pemain bergerak, ${playerManager.getAlivePlayers().length} selamat.`);

  // Lanjut ke ROUND_END
  trackedTimeout(() => {
    transitionTo(STATES.ROUND_END);
  }, Math.random() * (2000 - 800) + 800);
}

// ===================== STATE: ROUND_END =====================
function onEnterRoundEnd() {
  const alive = playerManager.getAlivePlayers();

  // Random delay 1-3 detik sebelum lanjut
  const randomDelay = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;

  if (alive.length >= 2) {
    // Lanjut ke lampu berikutnya (random green light)
    console.log(`[GameEngine] ${alive.length} pemain tersisa, lanjut dalam ${randomDelay}ms...`);
    trackedTimeout(() => {
      transitionTo(STATES.GREEN_LIGHT);
    }, randomDelay);
  } else if (alive.length === 1) {
    // 1 pemain tersisa → dia menang
    const winner = playerManager.setWinner(alive[0].uniqueId);
    
    // Record stats untuk last survivor
    if (winner) {
      statsTracker.recordWinner(winner.uniqueId, winner.username);
    }
    
    console.log(`[GameEngine] 🏆 ${winner?.username} adalah satu-satunya yang tersisa!`);
    trackedTimeout(() => {
      transitionTo(STATES.GAME_OVER);
    }, 500);
  } else {
    // 0 pemain tersisa → draw (tidak ada pemenang)
    console.log('[GameEngine] DRAW — semua pemain tereliminasi!');
    trackedTimeout(() => {
      transitionTo(STATES.GAME_OVER);
    }, 500);
  }
}

// ===================== STATE: GAME_OVER =====================
function onEnterGameOver() {
  // Cari winner (bisa dari triggerWin langsung atau satu-satunya survivor)
  const allPlayers = playerManager.getAllPlayers();
  const winner = allPlayers.find(p => p.status === 'winner') || null;
  const aliveCount = allPlayers.filter(p => p.status === 'alive').length;

  if (io) {
    io.emit('state:update', {
      state: 'game_over',
      winner: winner,
      players: allPlayers,
      finishedCount: finishedCount,
      maxFinish: MAX_FINISH,
      elapsed: gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0
    });
    
    // Hanya emit winner event jika ada winner
    if (winner) {
      io.emit('player:winner', { player: winner });
    }
  }

  if (winner) {
    console.log(`[GameEngine] 🎉 GAME OVER — ${winner.username} MENANG!`);
  } else if (aliveCount === 0) {
    console.log('[GameEngine] GAME OVER — DRAW (semua pemain tereliminasi). Auto-restart dalam 3 detik...');
  } else {
    console.log('[GameEngine] GAME OVER — DRAW (tidak ada pemenang).');
  }

  // Setelah 3 detik → kembali ke IDLE (auto-restart)
  trackedTimeout(() => {
    console.log('[GameEngine] Auto-restarting ke IDLE...');
    transitionTo(STATES.IDLE);
  }, 3000);
}

// ===================== HELPER FUNCTIONS =====================

/**
 * Eliminasi semua pemain yang belum finish.
 * Digunakan saat batas MAX_FINISH tercapai.
 */
function eliminateRemaining() {
  const allPlayers = playerManager.getAllPlayers();
  let eliminated = 0;

  for (const player of allPlayers) {
    if (player.status === 'alive' && player.posisi < 100) {
      playerManager.eliminatePlayer(player.uniqueId, 'not_finished');
      if (io) {
        io.emit('player:eliminated', {
          player: { ...player },
          reason: 'not_finished'
        });
      }
      eliminated++;
    }
  }

  console.log(`[GameEngine] 🗑️ ${eliminated} pemain dieliminasi (belum finish).`);
}

/**
 * Hentikan game loop (movement interval).
 */
function stopGameLoop() {
  if (gameLoop) {
    clearInterval(gameLoop);
    gameLoop = null;
    console.log('[GameEngine] Game loop dihentikan.');
  }
}

/**
 * Hapus semua timeout dan interval yang sedang aktif.
 */
function clearAllTimeouts() {
  for (const t of activeTimeouts) {
    clearTimeout(t);
  }
  activeTimeouts = [];
  console.log('[GameEngine] Semua timeouts dibersihkan.');
}

/**
 * Trigger kemenangan pemain (dari gift Lion atau mencapai finish).
 */
function triggerWin(player) {
  console.log(`[GameEngine] 🏆 triggerWin: ${player.username}`);
  stopGameLoop();
  
  // Eliminasi semua pemain lain langsung
  const allPlayers = playerManager.getAllPlayers();
  
  // Cari juara 2 dan 3 sebelum eliminasi
  const alivePlayers = allPlayers.filter(p => p.status === 'alive' && p.uniqueId !== player.uniqueId);
  const sortedByPosition = [...alivePlayers].sort((a, b) => b.posisi - a.posisi);
  
  // Record juara 2 dan 3
  if (sortedByPosition.length >= 1) {
    statsTracker.recordRunnerUp(sortedByPosition[0].uniqueId, sortedByPosition[0].username);
  }
  if (sortedByPosition.length >= 2) {
    statsTracker.recordThirdPlace(sortedByPosition[1].uniqueId, sortedByPosition[1].username);
  }
  
  for (const p of allPlayers) {
    if (p.uniqueId !== player.uniqueId && p.status === 'alive') {
      playerManager.eliminatePlayer(p.uniqueId, 'winner_declared');
      if (io) {
        io.emit('player:eliminated', {
          player: { ...p },
          reason: 'winner_declared'
        });
      }
    }
  }
  
  // Record winner dan tambah poin
  statsTracker.recordWinner(player.uniqueId, player.username);
  playerManager.setWinner(player.uniqueId);
  transitionTo(STATES.GAME_OVER);
}

// ===================== PUBLIC API =====================

/**
 * Inisialisasi engine dengan socket.io instance.
 */
function init(socketIO) {
  io = socketIO;
  console.log('[GameEngine] Initialized with socket.io instance.');
  // Mulai dari IDLE
  transitionTo(STATES.IDLE);
}

/**
 * Mulai game dari awal (LOBBY → COUNTDOWN → ...).
 */
function startGame() {
  console.log('[GameEngine] host:start — memulai game...');
  
  if (currentState !== STATES.IDLE) {
    console.warn(`[GameEngine] ❌ Tidak bisa start dari state: ${currentState}`);
    if (io) {
      io.emit('error', {
        type: 'invalid_state',
        message: `Game tidak bisa dimulai dari state "${currentState}". Reset game terlebih dahulu.`
      });
    }
    return;
  }

  // Cek jumlah pemain yang ready
  const readyPlayers = playerManager.getAllPlayers().filter(p => p.status === 'alive');
  
  if (readyPlayers.length < 2) {
    const errorMsg = `Game TIDAK bisa dimulai! Minimal 2 pemain, saat ini: ${readyPlayers.length} pemain.`;
    console.error(`[GameEngine] ❌ ${errorMsg}`);
    
    if (io) {
      io.emit('error', {
        type: 'not_enough_players',
        message: errorMsg,
        currentPlayers: readyPlayers.length,
        minimumRequired: 2
      });
    }
    return;
  }

  console.log(`[GameEngine] ✅ Memulai game dengan ${readyPlayers.length} pemain...`);
  gameStartTime = Date.now(); // Mulai timer
  transitionTo(STATES.LOBBY);
  // Delay 2 detik sebelum countdown
  trackedTimeout(() => {
    transitionTo(STATES.COUNTDOWN);
  }, 2000);
}

/**
 * Reset game kembali ke IDLE.
 */
function resetGame() {
  console.log('[GameEngine] host:reset — reset game...');
  transitionTo(STATES.IDLE);
}

/**
 * Override manual: paksa ke GREEN_LIGHT.
 */
function forceGreen() {
  console.log('[GameEngine] host:green — force green light...');

  // Hentikan game loop yang sedang berjalan
  stopGameLoop();

  // Reset finished count jika dari game_over
  if (currentState === STATES.GAME_OVER) {
    finishedCount = 0;
  }

  // Langsung transisi ke GREEN_LIGHT
  if (io) {
    io.emit('state:update', {
      state: 'green_light',
      players: playerManager.getAllPlayers()
    });
  }
  console.log(`[GameEngine] 🟢 LAMPU HIJAU (manual override)`);

  // Update state langsung tanpa trigger transisi resmi
  currentState = STATES.GREEN_LIGHT;
  
  // Mulai game loop baru
  gameLoop = setInterval(() => {
    // CEK WAKTU GAME - jika habis, eliminasi semua yang belum finish
    const elapsed = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
    if (elapsed >= MAX_GAME_TIME) {
      console.log(`[GameEngine] ⏰ WAKTU HABIS (${MAX_GAME_TIME}s)! Eliminasi semua pemain yang belum finish...`);
      eliminateRemaining();
      transitionTo(STATES.GAME_OVER);
      return;
    }

    const alivePlayers = playerManager.getAlivePlayers();

    for (const player of alivePlayers) {
      // Cek apakah pemain sedang dibekukan
      if (Date.now() < frozenUntil) {
        continue;
      }

      // Gerakkan pemain ke atas
      player.posisi = parseFloat((player.posisi + player.kecepatan * 0.08).toFixed(2));

      // Cek apakah sudah sampai finish (HANYA sekali per pemain!)
      if (player.posisi >= 100 && !finishedPlayers.has(player.uniqueId)) {
        // Tandai player sudah finish
        finishedPlayers.add(player.uniqueId);

        finishedCount++;
        const rank = finishedCount;
        console.log(`[GameEngine] 🏆 ${player.username} mencapai FINISH! (Posisi #${rank})`);

        // Record stats untuk pemenang
        if (rank === 1) {
          statsTracker.recordWinner(player.uniqueId, player.username);
        } else if (rank === 2) {
          statsTracker.recordRunnerUp(player.uniqueId, player.username);
        } else if (rank === 3) {
          statsTracker.recordThirdPlace(player.uniqueId, player.username);
        } else {
          const finishPoints = Math.max(10, 50 - (rank * 5));
          statsTracker.addPoints(player.uniqueId, finishPoints, `finish_rank_${rank}`);
        }

        if (finishedCount >= MAX_FINISH) {
          console.log(`[GameEngine] Batas ${MAX_FINISH} pemain tercapai! Eliminasi sisa pemain...`);
          eliminateRemaining();
          transitionTo(STATES.GAME_OVER);
          return;
        }

        // Emit notifikasi finish ke overlay
        if (io) {
          io.emit('player:finished', {
            uniqueId: player.uniqueId,
            username: player.username,
            rank: rank
          });
        }
        return;
      }
    }

    // Emit posisi terbaru
    if (io) {
      io.emit('state:update', {
        state: 'green_light',
        players: playerManager.getAllPlayers(),
        finishedCount: finishedCount,
        maxFinish: MAX_FINISH,
        elapsed: gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0
      });
    }
  }, 100);
}

/**
 * Override manual: paksa ke RED_LIGHT.
 */
function forceRed() {
  console.log('[GameEngine] host:red — force red light...');
  
  // Hentikan game loop
  stopGameLoop();
  
  // Snapshot posisi semua pemain
  playerManager.snapshotPositions();
  
  // Langsung transisi ke RED_LIGHT
  if (io) {
    const elapsed = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
    io.emit('state:update', {
      state: 'red_light',
      players: playerManager.getAllPlayers(),
      finishedCount: finishedCount,
      maxFinish: MAX_FINISH,
      elapsed: elapsed,
      timeRemaining: Math.max(0, MAX_GAME_TIME - elapsed)
    });
  }
  console.log(`[GameEngine] 🔴 LAMPU MERAH (manual override) — BERHENTI!`);

  // Update state langsung
  currentState = STATES.RED_LIGHT;
  
  // Setelah 3 detik → CHECKING (manual)
  setTimeout(() => {
    enterCheckingManual();
  }, 3000);
}

/**
 * Ambil state saat ini.
 */
function getState() {
  return currentState;
}

/**
 * Helper untuk manual checking (dari forceRed)
 */
function enterCheckingManual() {
  // Cek pemain yang bergerak
  const moved = playerManager.getMovedPlayers();

  // Eliminasi semua yang bergerak
  for (const player of moved) {
    playerManager.eliminatePlayer(player.uniqueId, 'moved');
    if (io) {
      io.emit('player:eliminated', { player, reason: 'moved' });
    }
  }

  if (io) {
    io.emit('state:update', {
      state: 'checking',
      eliminated: moved,
      safe: playerManager.getAlivePlayers(),
      players: playerManager.getAllPlayers(),
      finishedCount: finishedCount,
      maxFinish: MAX_FINISH,
      elapsed: gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0
    });
  }
  console.log(`[GameEngine] CHECKING (manual) — ${moved.length} pemain bergerak.`);

  // Setelah 2 detik → ROUND_END
  setTimeout(() => {
    enterRoundEndManual();
  }, 2000);
}

/**
 * Helper untuk manual round end (dari forceRed)
 */
function enterRoundEndManual() {
  const alive = playerManager.getAlivePlayers();

  if (alive.length >= 2) {
    // Bisa lanjut ke green light lagi
    console.log('[GameEngine] Menunggu host untuk lanjut...');
  } else if (alive.length === 1) {
    const winner = playerManager.setWinner(alive[0].uniqueId);
    console.log(`[GameEngine] 🏆 ${winner?.username} adalah satu-satunya yang tersisa!`);
    setTimeout(() => {
      transitionTo(STATES.GAME_OVER);
    }, 500);
  } else {
    console.log('[GameEngine] DRAW — semua pemain tereliminasi!');
    setTimeout(() => {
      transitionTo(STATES.GAME_OVER);
    }, 500);
  }
}

/**
 * Bekukan semua pemain selama durasi tertentu (gift Rose).
 * @param {number} duration - durasi dalam milidetik
 */
function freeze(duration) {
  frozenUntil = Date.now() + duration;
  console.log(`[GameEngine] ❄️ FREEZE selama ${duration}ms (sampai ${new Date(frozenUntil).toISOString()})`);
}

/**
 * Set flag untuk skip checking ronde berikutnya (gift Universe).
 */
function skipCheck() {
  skipNextCheck = true;
  console.log('[GameEngine] 🛡️ SKIP CHECK aktif untuk ronde berikutnya.');
}

/**
 * Gerakkan pemain sedikit saat mereka LIKE/TAP di TikTok Live.
 * Hanya bergerak saat lampu HIJAU. Jika like saat MERAH, langsung eliminasi!
 *
 * @param {string} uniqueId - ID pemain yang like
 * @param {number} likeCount - jumlah like (untuk boost)
 * @returns {Object|null} - { player, newPosition } atau null
 */
function moveOnLike(uniqueId, likeCount = 1) {
  const playerManager = require('./playerManager');
  const player = playerManager.getPlayer(uniqueId);

  if (!player) {
    console.warn(`[GameEngine] moveOnLike: ${uniqueId} tidak ditemukan.`);
    return null;
  }

  // Jika pemain sudah eliminated atau winner, skip
  if (player.status !== 'alive') {
    return null;
  }

  // LIKE SAAT LAMPU MERAH = LANGSUNG ELIMINASI!
  if (currentState === 'red_light' || currentState === 'checking') {
    console.log(`[GameEngine] 🚫 ${player.username} like saat lampu ${currentState}! ELIMINASI!`);
    playerManager.eliminatePlayer(player.uniqueId, 'like_during_red');
    
    return { 
      player, 
      newPosition: player.posisi, 
      eliminated: true,
      reason: 'like_during_red'
    };
  }

  // Hanya bergerak saat lampu hijau
  if (currentState !== 'green_light') {
    console.log(`[GameEngine] moveOnLike: ${player.username} tidak bisa move saat state ${currentState}`);
    return { player, newPosition: player.posisi, blocked: true };
  }

  // Bergerak maju: base 0.15 + (likeCount * 0.02) — DIPERLAMBAT
  // Max 1.0 per like (cap untuk mencegah exploit)
  const boost = Math.min(likeCount * 0.02, 1.0);
  const movement = 0.15 + boost;
  player.posisi = parseFloat((player.posisi + movement).toFixed(2));

  // Cek apakah sudah finish (HANYA sekali per pemain!)
  if (player.posisi >= 100 && !finishedPlayers.has(player.uniqueId)) {
    finishedPlayers.add(player.uniqueId);
    console.log(`[GameEngine] 🏆 ${player.username} mencapai FINISH via LIKE!`);
    triggerWin(player);
    return { player, newPosition: 100, finished: true };
  }

  console.log(`[GameEngine] 👍 ${player.username} like! Move +${movement.toFixed(2)} → ${player.posisi}%`);

  return { player, newPosition: player.posisi, blocked: false };
}

// ===================== EXPORTS =====================
module.exports = {
  init,
  startGame,
  resetGame,
  forceGreen,
  forceRed,
  getState,
  freeze,
  skipCheck,
  triggerWin,
  moveOnLike,
  getTimer: () => ({
    elapsed: gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0,
    finishedCount,
    maxFinish: MAX_FINISH
  }),
  STATES
};
