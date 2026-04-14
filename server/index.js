/**
 * index.js — Entry Point Server
 * 
 * Setup:
 * - Express + CORS (allow all origin)
 * - Socket.io attached ke Express server
 * - Serve folder overlay/ dan dashboard/ sebagai static files
 * - Import dan init gameEngine, tiktok, playerManager
 * - Socket listener untuk event dari dashboard
 * - Debug endpoints untuk testing tanpa TikTok
 */

// ===================== IMPORTS =====================
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const gameEngine = require('./gameEngine');
const tiktok = require('./tiktok');
const playerManager = require('./playerManager');
const giftHandler = require('./giftHandler');

// ===================== EXPRESS SETUP =====================
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' })); // Allow all origin
app.use(express.json());

// Serve static files
app.use('/overlay', express.static(path.join(__dirname, '..', 'overlay')));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

// ===================== HTTP SERVER + SOCKET.IO =====================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ===================== SOCKET.IO SETUP =====================
io.on('connection', (socket) => {
  console.log(`[Socket.io] ✅ Client connected: ${socket.id}`);

  // Helper untuk dapat current state
  const getCurrentState = () => gameEngine.getState();

  // Kirim status awal saat client connect
  const currentUsername = tiktok.getCurrentUsername();
  const tiktokStatus = tiktok.getConnectionStatus();
  socket.emit('tiktok:status', {
    status: tiktokStatus.connected ? 'connected' : 'disconnected',
    username: currentUsername
  });
  socket.emit('state:update', {
    state: getCurrentState(),
    players: playerManager.getAllPlayers()
  });

  // ---------- EVENT DARI DASHBOARD ----------

  // Mulai game
  socket.on('host:start', () => {
    console.log(`[Socket.io] host:start dari ${socket.id}`);
    gameEngine.startGame();
  });

  // Reset game
  socket.on('host:reset', () => {
    console.log(`[Socket.io] host:reset dari ${socket.id}`);
    gameEngine.resetGame();
  });

  // Force lampu hijau (manual override)
  socket.on('host:green', () => {
    console.log(`[Socket.io] host:green dari ${socket.id}`);
    gameEngine.forceGreen();
  });

  // Force lampu merah (manual override)
  socket.on('host:red', () => {
    console.log(`[Socket.io] host:red dari ${socket.id}`);
    gameEngine.forceRed();
  });

  // Kick pemain
  socket.on('host:kick', ({ uniqueId }) => {
    console.log(`[Socket.io] host:kick dari ${socket.id} → ${uniqueId}`);
    const result = playerManager.eliminatePlayer(uniqueId, 'kick');
    if (result) {
      io.emit('player:eliminated', { player: result.player, reason: 'kick' });
      console.log(`[Socket.io] ${result.player.username} dikick dari game.`);
    } else {
      console.warn(`[Socket.io] host:kick gagal — pemain ${uniqueId} tidak ditemukan.`);
    }
  });

  // ---------- EVENT CAMERA ----------
  // Toggle kamera host
  socket.on('camera:toggle', ({ enabled }) => {
    console.log(`[Socket.io] camera:toggle dari ${socket.id} → ${enabled ? 'ON' : 'OFF'}`);
    // Broadcast ke semua overlay clients
    io.emit('camera:toggle', { enabled });
  });

  // ---------- EVENT TIKTOK CONFIG ----------

  // Connect ke TikTok Live
  socket.on('tiktok:connect', ({ username }) => {
    console.log(`[Socket.io] tiktok:connect dari ${socket.id} → @${username}`);
    tiktok.manualConnect(username);
  });

  // Disconnect dari TikTok Live
  socket.on('tiktok:disconnect', () => {
    console.log(`[Socket.io] tiktok:disconnect dari ${socket.id}`);
    tiktok.manualDisconnect();
  });

  // Request current TikTok config
  socket.on('tiktok:getConfig', () => {
    const currentUsername = tiktok.getCurrentUsername();
    const status = tiktok.getConnectionStatus();
    socket.emit('tiktok:config', {
      username: currentUsername,
      connected: status.connected,
      attempts: status.attempts
    });
  });

  // Request post-game stats
  socket.on('stats:get', () => {
    const stats = statsTracker.getPostGameStats();
    socket.emit('stats:postgame', stats);
  });

  // Player LIKE/TAP — gerakkan pemain sedikit
  socket.on('player:like', ({ uniqueId, likeCount }) => {
    const result = gameEngine.moveOnLike(uniqueId, likeCount || 1);
    
    if (!result) {
      return; // Player tidak ditemukan
    }

    // Jika player tereliminasi karena like saat lampu merah
    if (result.eliminated) {
      const timer = gameEngine.getTimer();
      io.emit('state:update', {
        state: getCurrentState(),
        players: playerManager.getAllPlayers(),
        elapsed: timer.elapsed,
        finishedCount: timer.finishedCount,
        maxFinish: timer.maxFinish
      });
      io.emit('player:likeEliminated', {
        uniqueId: result.player.uniqueId,
        username: result.player.username,
        posisi: result.newPosition,
        reason: result.reason
      });
      return;
    }

    if (!result.blocked) {
      const timer = gameEngine.getTimer();
      // Emit posisi baru ke semua client
      io.emit('state:update', {
        state: getCurrentState(),
        players: playerManager.getAllPlayers(),
        elapsed: timer.elapsed,
        finishedCount: timer.finishedCount,
        maxFinish: timer.maxFinish
      });
      io.emit('player:moved', {
        uniqueId: result.player.uniqueId,
        username: result.player.username,
        posisi: result.newPosition,
        finished: result.finished || false
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket.io] ❌ Client disconnected: ${socket.id}`);
  });
});

// ===================== INITIALIZE MODULES =====================
// Init playerManager dengan reference ke gameEngine.getState
playerManager.init(() => gameEngine.getState());

// Init gameEngine dengan socket.io instance
gameEngine.init(io);

// Export statsTracker untuk socket
const statsTracker = require('./statsTracker');

// Init TikTok connection (akan skip jika TIKTOK_USERNAME belum diset)
tiktok.init(io);

// ===================== DEBUG ENDPOINTS =====================
// Endpoint untuk testing tanpa TikTok Live

// POST /debug/join — Tambah pemain manual
app.post('/debug/join', (req, res) => {
  try {
    const { uniqueId, username, avatarUrl } = req.body;

    if (!uniqueId || !username) {
      return res.status(400).json({
        error: 'uniqueId dan username wajib diisi'
      });
    }

    const result = playerManager.addPlayer({
      uniqueId: uniqueId || `debug_${Date.now()}`,
      username: username || `User_${Date.now()}`,
      avatarUrl: avatarUrl || ''
    });

    // Jika berhasil join, emit ke semua client
    if (!result.error && !result.waiting) {
      io.emit('player:joined', result);
    }

    res.json(result);
  } catch (err) {
    console.error('[Debug] Error di /debug/join:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /debug/gift — Trigger gift manual
app.post('/debug/gift', (req, res) => {
  try {
    const { giftName, uniqueId } = req.body;

    if (!giftName) {
      return res.status(400).json({
        error: 'giftName wajib diisi'
      });
    }

    const giftData = {
      uniqueId: uniqueId || 'debug_user',
      giftName: giftName,
      repeatEnd: true,
      repeatCount: 1
    };

    giftHandler.handleGift(giftData, io);

    res.json({ success: true, gift: giftName });
  } catch (err) {
    console.error('[Debug] Error di /debug/gift:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /debug/like — Trigger like manual (untuk testing)
app.post('/debug/like', (req, res) => {
  try {
    const { uniqueId, likeCount } = req.body;

    if (!uniqueId) {
      return res.status(400).json({
        error: 'uniqueId wajib diisi'
      });
    }

    const result = gameEngine.moveOnLike(uniqueId, likeCount || 1);

    if (!result) {
      return res.status(404).json({ error: 'Player tidak ditemukan' });
    }

    if (result.blocked) {
      return res.json({
        success: false,
        reason: 'player_blocked',
        message: 'Player tidak bisa bergerak saat state ini',
        position: result.newPosition
      });
    }

    // Emit ke semua client
    io.emit('state:update', {
      state: gameEngine.getState(),
      players: playerManager.getAllPlayers()
    });

    io.emit('player:moved', {
      uniqueId: result.player.uniqueId,
      username: result.player.username,
      posisi: result.newPosition,
      finished: result.finished || false
    });

    res.json({
      success: true,
      player: result.player.username,
      position: result.newPosition,
      finished: result.finished || false
    });
  } catch (err) {
    console.error('[Debug] Error di /debug/like:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /debug/state — Set state manual (untuk testing)
app.post('/debug/state', (req, res) => {
  try {
    const { state } = req.body;

    if (!state) {
      return res.status(400).json({
        error: 'state wajib diisi'
      });
    }

    const validStates = Object.values(gameEngine.STATES);
    if (!validStates.includes(state)) {
      return res.status(400).json({
        error: `State tidak valid. Pilihan: ${validStates.join(', ')}`
      });
    }

    // Transisi ke state yang diminta
    switch (state) {
      case 'idle':
        gameEngine.resetGame();
        break;
      case 'lobby':
        gameEngine.startGame();
        break;
      case 'green_light':
        gameEngine.forceGreen();
        break;
      case 'red_light':
        gameEngine.forceRed();
        break;
      default:
        // Untuk state lain, langsung transisi (internal)
        // Ini hanya untuk debugging, tidak pakai transisi resmi
        console.warn(`[Debug] Set state manual ke: ${state} (bypass transisi)`);
        break;
    }

    res.json({
      success: true,
      state: gameEngine.getState(),
      players: playerManager.getAllPlayers()
    });
  } catch (err) {
    console.error('[Debug] Error di /debug/state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /debug/players — Lihat semua pemain
app.get('/debug/players', (req, res) => {
  try {
    const players = playerManager.getAllPlayers();
    const alive = playerManager.getAlivePlayers();
    const waiting = playerManager.getWaitingList();

    res.json({
      total: players.length,
      alive: alive.length,
      waiting: waiting.length,
      players: players,
      waitingList: waiting
    });
  } catch (err) {
    console.error('[Debug] Error di /debug/players:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /debug/state — Lihat state saat ini
app.get('/debug/state', (req, res) => {
  try {
    res.json({
      state: gameEngine.getState(),
      players: playerManager.getAllPlayers(),
      alive: playerManager.getAlivePlayers().length
    });
  } catch (err) {
    console.error('[Debug] Error di /debug/state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================== ROOT ENDPOINT =====================
app.get('/', (req, res) => {
  res.json({
    name: 'TikTok Red Light Green Light Game',
    version: '1.0.0',
    endpoints: {
      overlay: '/overlay/index.html',
      dashboard: '/dashboard/index.html',
      debug: {
        join: 'POST /debug/join',
        gift: 'POST /debug/gift',
        state_set: 'POST /debug/state',
        state_get: 'GET /debug/state',
        players: 'GET /debug/players'
      }
    }
  });
});

// ===================== START SERVER =====================
server.listen(PORT, () => {
  console.log('========================================');
  console.log(`🎮 TikTok Red Light Green Light Game`);
  console.log(`🌐 Server berjalan di http://localhost:${PORT}`);
  console.log(`📺 Overlay: http://localhost:${PORT}/overlay/index.html`);
  console.log(`🎛️ Dashboard: http://localhost:${PORT}/dashboard/index.html`);
  console.log(`🔧 Debug API: http://localhost:${PORT}/debug/...`);
  console.log('========================================');
});

// ===================== GRACEFUL SHUTDOWN =====================
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Server closed.');
    process.exit(0);
  });
});

// ===================== EXPORTS (untuk testing) =====================
module.exports = { app, server, io };
