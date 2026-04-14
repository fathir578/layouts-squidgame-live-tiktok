/**
 * game.js — Overlay Game Logic
 *
 * Full game rendering menggunakan HTML5 Canvas.
 * Perspektif: TOP-DOWN (karakter maju ke ATAS menuju FINISH).
 * Karakter: stickman top-down + foto profil TikTok (lingkaran di kepala).
 * Mobile-responsive dengan dynamic scaling.
 */

// ===================== BAGIAN 1: KONSTANTA LAYOUT =====================
const CANVAS_W     = 1080;  // Portrait width
const CANVAS_H     = 1920;  // Portrait height

// Responsive scaling - hitung scale factor berdasarkan ukuran layar
let displayScale = 1.0;

/**
 * Update display scale berdasarkan ukuran window.
 */
function updateDisplayScale() {
  const canvasEl = document.getElementById('gameCanvas');
  const rect = canvasEl.getBoundingClientRect();
  displayScale = rect.width / CANVAS_W;
}

// Track FULL WIDTH - dari edge ke edge
const TRACK_LEFT   = 30;
const TRACK_RIGHT  = 1050;
const TRACK_TOP    = 250;  // Naikkan sedikit (finish line lebih visible)
const TRACK_BOTTOM = 1780;
const LANE_WIDTH   = (TRACK_RIGHT - TRACK_LEFT) / 30; // Max 30 pemain, full spread

// ===================== BAGIAN 2: STATE & DATA =====================
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');
const socket  = io('http://localhost:3000');

// Update scale on resize
window.addEventListener('resize', () => {
  updateDisplayScale();
  // Trigger resize canvas handler dari index.html
  if (typeof resizeCanvas === 'function') resizeCanvas();
});
updateDisplayScale();

let players         = [];
let gameState       = 'idle';
let giftEffect      = null;  // { type, sender, pesan, expiry }
let frameCount      = 0;
let winner          = null;
let confettiParticles = [];
let explosionParticles = []; // Partikel ledakan untuk eliminasi

// Timer & finish counter
let elapsedSeconds  = 0;
let finishedCount   = 0;
let maxFinish       = 10;
const MAX_GAME_TIME = 180; // 3 menit (harus sama dengan server)

// Finish notifications
let finishNotifications = []; // { username, rank, timestamp, expiry }

// Countdown display
let countdownNumber = null;
let countdownExpiry = 0;

// Like elimination notification
let likeEliminations = []; // { username, timestamp, expiry }

// Post-game stats
let postGameStats = null;

// ===================== BAGIAN 3: AVATAR CACHE =====================
const avatarCache = {};

/**
 * Load avatar dari URL, simpan di cache.
 */
function loadAvatar(player) {
  if (avatarCache[player.uniqueId] !== undefined) return;
  avatarCache[player.uniqueId] = null; // mark loading

  if (!player.avatarUrl) {
    // Tidak ada avatar URL, gunakan fallback
    avatarCache[player.uniqueId] = null;
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => {
    avatarCache[player.uniqueId] = img;
  };
  img.onerror = () => {
    avatarCache[player.uniqueId] = null;
  };
  img.src = player.avatarUrl;
}

// ===================== BAGIAN 4: ASSIGN LANE =====================
let laneIndex = 0;
const laneMap = {};  // uniqueId → x position

/**
 * Assign kolom X RANDOM saat join, menyebar FULL TRACK width.
 * Setiap pemain punya posisi X unik yang tidak numpuk.
 */
function assignLane(uniqueId) {
  if (laneMap[uniqueId] !== undefined) return laneMap[uniqueId];

  // Track width dan spacing
  const trackWidth = TRACK_RIGHT - TRACK_LEFT;
  const maxCols = 15; // Max 15 kolom per baris
  const spacing = trackWidth / (maxCols - 1);
  
  // Baris dan kolom berdasarkan urutan join
  const row = Math.floor(laneIndex / maxCols);
  const col = laneIndex % maxCols;
  
  // Random offset dalam kolom (supaya tidak terlalu rigid)
  const randomOffset = (Math.random() - 0.5) * (spacing * 0.4);
  
  // Hitung X dari kiri + offset random
  const x = TRACK_LEFT + (col * spacing) + randomOffset;
  
  // Clamp agar tidak keluar track
  laneMap[uniqueId] = Math.max(TRACK_LEFT + 20, Math.min(TRACK_RIGHT - 20, x));
  laneIndex++;

  return laneMap[uniqueId];
}

// ===================== BAGIAN 5: DRAW BACKGROUND =====================
function drawBackground() {
  // === SKY: Squid Game blue-white sky ===
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H * 0.35);
  skyGrad.addColorStop(0, '#87CEEB');
  skyGrad.addColorStop(0.5, '#B0E0E6');
  skyGrad.addColorStop(1, '#F0F8FF');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H * 0.35);

  // === SQUID GAME SHAPES IN SKY (Circle, Triangle, Square, Star) ===
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';

  const shapeSize = 50;
  const shapeY = 80;
  const spacing = 200;
  const startX = CANVAS_W / 2 - (spacing * 1.5);

  // Circle ○
  ctx.beginPath();
  ctx.arc(startX, shapeY, shapeSize * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Triangle △
  const triX = startX + spacing;
  ctx.beginPath();
  ctx.moveTo(triX, shapeY - shapeSize * 0.5);
  ctx.lineTo(triX - shapeSize * 0.5, shapeY + shapeSize * 0.5);
  ctx.lineTo(triX + shapeSize * 0.5, shapeY + shapeSize * 0.5);
  ctx.closePath();
  ctx.stroke();

  // Square □
  const sqX = startX + spacing * 2;
  ctx.strokeRect(sqX - shapeSize * 0.4, shapeY - shapeSize * 0.4, shapeSize * 0.8, shapeSize * 0.8);

  // Star ☆
  const starX = startX + spacing * 3;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = starX + Math.cos(angle) * shapeSize * 0.5;
    const y = shapeY + Math.sin(angle) * shapeSize * 0.5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // === GROUND: Squid Game sandy area ===
  const groundGrad = ctx.createLinearGradient(0, CANVAS_H * 0.35, 0, CANVAS_H);
  groundGrad.addColorStop(0, '#E8C396');
  groundGrad.addColorStop(0.3, '#D4A574');
  groundGrad.addColorStop(1, '#B8895C');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, CANVAS_H * 0.35, CANVAS_W, CANVAS_H * 0.65);

  // === SAND TEXTURE (reduced dots for performance) ===
  ctx.fillStyle = 'rgba(139, 90, 43, 0.12)';
  for (let i = 0; i < 100; i++) {
    const sx = (Math.sin(i * 123.456) * 0.5 + 0.5) * CANVAS_W;
    const sy = CANVAS_H * 0.35 + (Math.cos(i * 789.012) * 0.5 + 0.5) * (CANVAS_H * 0.65);
    ctx.beginPath();
    ctx.arc(sx, sy, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // === WALLS: Squid Game WHITE walls with colored accents ===
  const wallColor = '#F5F5F5';
  const wallAccent = '#1E90FF';
  const wallLeft = TRACK_LEFT - 25;
  const wallRight = TRACK_RIGHT + 25;

  // Left wall (white)
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, TRACK_TOP - 30, wallLeft, TRACK_BOTTOM - TRACK_TOP + 60);
  // Left wall blue accent
  ctx.fillStyle = wallAccent;
  ctx.fillRect(wallLeft - 8, TRACK_TOP - 30, 8, TRACK_BOTTOM - TRACK_TOP + 60);

  // Right wall (white)
  ctx.fillStyle = wallColor;
  ctx.fillRect(wallRight, TRACK_TOP - 30, CANVAS_W - wallRight, TRACK_BOTTOM - TRACK_TOP + 60);
  // Right wall blue accent
  ctx.fillStyle = wallAccent;
  ctx.fillRect(wallRight, TRACK_TOP - 30, 8, TRACK_BOTTOM - TRACK_TOP + 60);

  // === SHAPES on walls (Circle, Triangle, Square, Star) ===
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 5;
  const wallShapeY = TRACK_TOP + 50;

  // Circle
  ctx.beginPath();
  ctx.arc(wallLeft / 2, wallShapeY, 30, 0, Math.PI * 2);
  ctx.stroke();

  // Triangle
  ctx.beginPath();
  ctx.moveTo(CANVAS_W - wallLeft / 2, wallShapeY - 30);
  ctx.lineTo(CANVAS_W - wallLeft / 2 - 30, wallShapeY + 30);
  ctx.lineTo(CANVAS_W - wallLeft / 2 + 30, wallShapeY + 30);
  ctx.closePath();
  ctx.stroke();

  // Square
  ctx.strokeRect(wallLeft / 2 - 25, wallShapeY + 80, 50, 50);

  // Star
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = CANVAS_W - wallLeft / 2 + Math.cos(angle) * 30;
    const y = wallShapeY + 80 + Math.sin(angle) * 30;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // === TRACK: Sandy game area ===
  const trackGrad = ctx.createLinearGradient(0, TRACK_TOP, 0, TRACK_BOTTOM);
  trackGrad.addColorStop(0, '#C4956A');
  trackGrad.addColorStop(0.5, '#B8895C');
  trackGrad.addColorStop(1, '#A67B5B');
  ctx.fillStyle = trackGrad;
  ctx.fillRect(TRACK_LEFT, TRACK_TOP, TRACK_RIGHT - TRACK_LEFT, TRACK_BOTTOM - TRACK_TOP);

  // Track border
  ctx.strokeStyle = gameState === 'green_light' ? '#1D9E75' : '#E24B4A';
  ctx.lineWidth = 5;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 15;
  ctx.strokeRect(TRACK_LEFT, TRACK_TOP, TRACK_RIGHT - TRACK_LEFT, TRACK_BOTTOM - TRACK_TOP);
  ctx.shadowBlur = 0;

  // Grid lines (reduced for performance)
  ctx.strokeStyle = 'rgba(139, 90, 43, 0.12)';
  ctx.lineWidth = 1;
  for (let y = TRACK_TOP; y < TRACK_BOTTOM; y += 80) {
    ctx.beginPath();
    ctx.moveTo(TRACK_LEFT, y);
    ctx.lineTo(TRACK_RIGHT, y);
    ctx.stroke();
  }

  // === START LINE (bottom) ===
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillRect(TRACK_LEFT, TRACK_BOTTOM - 6, TRACK_RIGHT - TRACK_LEFT, 6);

  // === GRASS: Rumput hijau di bawah track (reduced for performance) ===
  const grassTop = TRACK_BOTTOM + 15;
  const grassHeight = CANVAS_H - grassTop;

  // Base grass
  const grassGrad = ctx.createLinearGradient(0, grassTop, 0, CANVAS_H);
  grassGrad.addColorStop(0, '#2D5A27');
  grassGrad.addColorStop(0.3, '#1E4D1A');
  grassGrad.addColorStop(1, '#0F3D0C');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, grassTop, CANVAS_W, grassHeight);

  // Grass blades (reduced: 120 dari 300)
  ctx.strokeStyle = '#3A7A33';
  ctx.lineWidth = 2;
  const grassSway = Math.sin(Date.now() * 0.002) * 3;
  for (let i = 0; i < 120; i++) {
    const gx = (Math.sin(i * 456.789) * 0.5 + 0.5) * CANVAS_W;
    const gy = grassTop + (Math.cos(i * 123.456) * 0.5 + 0.5) * grassHeight;

    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.quadraticCurveTo(gx + grassSway, gy - 12, gx + grassSway * 1.5, gy - 20);
    ctx.stroke();
  }

  // Grass highlights (reduced: 60 dari 150)
  ctx.strokeStyle = '#4A9A43';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 60; i++) {
    const gx = (Math.sin(i * 789.012) * 0.5 + 0.5) * CANVAS_W;
    const gy = grassTop + (Math.cos(i * 345.678) * 0.5 + 0.5) * grassHeight;

    ctx.beginPath();
    ctx.moveTo(gx, gy + 5);
    ctx.quadraticCurveTo(gx + grassSway * 0.8, gy - 8, gx + grassSway, gy - 15);
    ctx.stroke();
  }

  // Small flowers (reduced: 8 dari 12)
  const flowerColors = ['#FF6B8A', '#FFD93D', '#FF8C42', '#C44569'];
  for (let i = 0; i < 8; i++) {
    const fx = (Math.sin(i * 234.567) * 0.5 + 0.5) * CANVAS_W;
    const fy = grassTop + 20 + (Math.cos(i * 678.901) * 0.5 + 0.5) * (grassHeight - 40);

    ctx.fillStyle = flowerColors[i % flowerColors.length];
    ctx.beginPath();
    ctx.arc(fx, fy, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(fx, fy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // START label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 10;
  ctx.fillText('🏁 MULAI', CANVAS_W / 2, grassTop + 50);
  ctx.shadowBlur = 0;

  // === FINISH LINE (top) ===
  const finishGlow = Math.sin(Date.now() * 0.003) * 0.3 + 0.7;
  const stripeW = 50;
  for (let x = TRACK_LEFT; x < TRACK_RIGHT; x += stripeW) {
    const idx = Math.floor((x - TRACK_LEFT) / stripeW);
    if (idx % 2 === 0) {
      ctx.fillStyle = `rgba(226, 75, 74, ${0.7 + finishGlow * 0.3})`;
    } else {
      ctx.fillStyle = 'white';
    }
    ctx.fillRect(x, TRACK_TOP - 8, stripeW, 24);
  }

  // FINISH label
  ctx.shadowColor = 'rgba(239, 159, 39, 0.9)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#EF9F27';
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('🏆 FINISH', CANVAS_W / 2, TRACK_TOP - 45);
  ctx.shadowBlur = 0;
}

// ===================== BAGIAN 6: DRAW STICKMAN TOP-DOWN =====================
function drawStickman(player) {
  // Skip rendering jika opacity 0
  if (player.opacity === 0) return;

  // PERFORMANCE: Skip effects untuk 50+ players
  const manyPlayers = players.length > 50;
  const ultraMany = players.length > 100;

  const cx = assignLane(player.uniqueId);

  // Konversi posisi 0-100 ke koordinat Y canvas
  const cy = TRACK_BOTTOM - (player.posisi / 100) * (TRACK_BOTTOM - TRACK_TOP - 80);

  // Animasi gerakan (reduced calculation)
  const isMoving = gameState === 'green_light' && player.status === 'alive';
  const swing = isMoving ? Math.sin(Date.now() * 0.008 + player.phase) * (manyPlayers ? 8 : 15) : 0;

  // Opacity eliminasi
  const opacity = player.opacity ?? 1;
  ctx.globalAlpha = opacity;

  // Offset shake saat eliminasi
  const shakeX = player.shakeX ?? 0;

  // PERFORMANCE: Shadow hanya untuk player dekat kamera atau < 30 players
  if (!manyPlayers) {
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 10;
  }

  // Bayangan oval (di tanah)
  ctx.beginPath();
  ctx.ellipse(cx + shakeX, cy + 10, 28, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();

  // PERFORMANCE: Skip glow saat banyak players
  if (player.status === 'alive' && !manyPlayers) {
    ctx.beginPath();
    ctx.arc(cx + shakeX, cy, 35, 0, Math.PI * 2);
    ctx.fillStyle = player.color + '15';
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Badan oval (tampak atas)
  ctx.beginPath();
  ctx.ellipse(cx + shakeX, cy, ultraMany ? 14 : 18, ultraMany ? 22 : 28, 0, 0, Math.PI * 2);
  ctx.fillStyle = player.color + (ultraMany ? '66' : '55');
  ctx.fill();
  ctx.strokeStyle = player.color;
  ctx.lineWidth = ultraMany ? 3 : 4;
  ctx.stroke();

  // Tangan dan kaki (garis)
  ctx.strokeStyle = player.color;
  ctx.lineWidth = ultraMany ? 3 : 5;
  ctx.lineCap = 'round';

  // Tangan kiri
  ctx.beginPath();
  ctx.moveTo(cx + shakeX - 15, cy - 8);
  ctx.lineTo(cx + shakeX - 35, cy - 8 + swing * 0.7);
  ctx.stroke();

  // Tangan kanan
  ctx.beginPath();
  ctx.moveTo(cx + shakeX + 15, cy - 8);
  ctx.lineTo(cx + shakeX + 35, cy - 8 - swing * 0.7);
  ctx.stroke();

  // Kaki kiri
  ctx.beginPath();
  ctx.moveTo(cx + shakeX - 8, cy + 20);
  ctx.lineTo(cx + shakeX - 15, cy + 45 + swing * 0.6);
  ctx.stroke();

  // Kaki kanan
  ctx.beginPath();
  ctx.moveTo(cx + shakeX + 8, cy + 20);
  ctx.lineTo(cx + shakeX + 15, cy + 45 - swing * 0.6);
  ctx.stroke();

  // Kepala (lingkaran dengan border warna pemain)
  ctx.beginPath();
  ctx.arc(cx + shakeX, cy - 42, 30, 0, Math.PI * 2);
  ctx.fillStyle = player.color + '44';
  ctx.fill();
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 4;
  ctx.stroke();

  // PERFORMANCE: Avatar rendering hanya untuk < 50 players
  const avatar = avatarCache[player.uniqueId];
  if (avatar && !manyPlayers) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + shakeX, cy - 42, 25, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, cx + shakeX - 25, cy - 67, 50, 50);
    ctx.restore();
  } else if (!avatar && ultraMany) {
    // PERFORMANCE: Just initial saat ultra many players
    ctx.fillStyle = player.color;
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.username[0].toUpperCase(), cx + shakeX, cy - 42);
  } else if (!avatar) {
    ctx.fillStyle = player.color;
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.username[0].toUpperCase(), cx + shakeX, cy - 42);
  }

  // PERFORMANCE: Progress bar hanya untuk < 50 players
  if (player.status === 'alive' && !manyPlayers) {
    const barW = 50;
    const barH = 8;
    const barX = cx + shakeX - barW / 2;
    const barY = cy + 58;
    const progress = Math.min(1, player.posisi / 100);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    ctx.fillStyle = player.color;
    ctx.fillRect(barX, barY, barW * progress, barH);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(player.posisi)}%`, cx + shakeX, barY + 20);
  }

  // PERFORMANCE: Username lebih kecil saat banyak players
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = manyPlayers ? 3 : ultraMany ? 2 : 8;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = manyPlayers ? 'bold 20px monospace' : 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const usernameDisplay = ultraMany && player.username.length > 6
    ? '@' + player.username.substring(0, 6)
    : manyPlayers && player.username.length > 10
      ? '@' + player.username.substring(0, 10)
      : '@' + player.username;
  ctx.fillText(usernameDisplay, cx + shakeX, cy + 65);
  ctx.shadowBlur = 0;

  // PERFORMANCE: Skip boost flash saat banyak players
  if (player.boostFlash && player.boostFlash > 0 && !manyPlayers) {
    ctx.globalAlpha = player.boostFlash;
    ctx.fillStyle = '#EF9F27';
    ctx.beginPath();
    ctx.arc(cx + shakeX, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Fade out
    player.boostFlash -= 0.03;
    if (player.boostFlash <= 0) {
      player.boostFlash = 0;
    }
  }

  // Badge status
  if (player.status === 'eliminated') {
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#E24B4A';
    ctx.font = 'bold 36px monospace';
    ctx.fillText('❌ OUT', cx + shakeX, cy + 85);
    ctx.shadowBlur = 0;
  } else if (player.status === 'winner') {
    ctx.shadowColor = 'rgba(239, 159, 39, 0.9)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#EF9F27';
    ctx.font = 'bold 42px monospace';
    ctx.fillText('🏆 WINNER', cx + shakeX, cy + 85);
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
}

// ===================== BAGIAN 7: DRAW LAMPU =====================
function drawLamp(isRed) {
  const scale = 1.5;
  const lx = 20, ly = 30;

  // Tiang dengan gradient metalik
  const poleGrad = ctx.createLinearGradient(lx, ly, lx + 30 * scale, ly);
  poleGrad.addColorStop(0, '#555');
  poleGrad.addColorStop(0.5, '#888');
  poleGrad.addColorStop(1, '#555');
  ctx.fillStyle = poleGrad;
  ctx.fillRect(lx + 20, ly, 14 * scale, 120 * scale);

  // Kotak lampu dengan 3D effect
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(lx, ly, 74 * scale, 130 * scale, 15 * scale);
  ctx.fill();

  // Border 3D
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(lx, ly, 74 * scale, 130 * scale, 15 * scale);
  ctx.stroke();

  // Highlight atas
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.roundRect(lx + 5, ly + 5, 64 * scale, 30, 8);
  ctx.fill();

  // Glow efek
  ctx.shadowBlur = 0;
  if (isRed) {
    ctx.shadowColor = '#E24B4A';
    ctx.shadowBlur = 40;
  } else {
    ctx.shadowColor = '#1D9E75';
    ctx.shadowBlur = 40;
  }

  // Lampu merah (atas) - LEBIH BESAR
  ctx.beginPath();
  ctx.arc(lx + 37 * scale, ly + 38 * scale, 28 * scale, 0, Math.PI * 2);
  ctx.fillStyle = isRed ? '#E24B4A' : '#220000';
  ctx.fill();

  // Inner glow lampu merah
  if (isRed) {
    const redGlow = ctx.createRadialGradient(lx + 37 * scale, ly + 38 * scale, 0, lx + 37 * scale, ly + 38 * scale, 28 * scale);
    redGlow.addColorStop(0, 'rgba(255, 200, 200, 0.8)');
    redGlow.addColorStop(0.5, 'rgba(255, 100, 100, 0.4)');
    redGlow.addColorStop(1, 'rgba(226, 75, 74, 0)');
    ctx.fillStyle = redGlow;
    ctx.beginPath();
    ctx.arc(lx + 37 * scale, ly + 38 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lampu hijau (bawah) - LEBIH BESAR
  ctx.beginPath();
  ctx.arc(lx + 37 * scale, ly + 90 * scale, 28 * scale, 0, Math.PI * 2);
  ctx.fillStyle = isRed ? '#002200' : '#1D9E75';
  ctx.fill();

  // Inner glow lampu hijau
  if (!isRed) {
    const greenGlow = ctx.createRadialGradient(lx + 37 * scale, ly + 90 * scale, 0, lx + 37 * scale, ly + 90 * scale, 28 * scale);
    greenGlow.addColorStop(0, 'rgba(200, 255, 220, 0.8)');
    greenGlow.addColorStop(0.5, 'rgba(100, 255, 150, 0.4)');
    greenGlow.addColorStop(1, 'rgba(29, 158, 117, 0)');
    ctx.fillStyle = greenGlow;
    ctx.beginPath();
    ctx.arc(lx + 37 * scale, ly + 90 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Label state
  ctx.shadowBlur = 0;
  ctx.fillStyle = isRed ? '#E24B4A' : '#1D9E75';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(isRed ? 'STOP' : 'GO', lx + 37 * scale, ly + 125 * scale);

  // Reset shadow
  ctx.shadowBlur = 0;
}

// ===================== BAGIAN 8: DRAW HUD =====================
function drawHUD() {
  const alive = players.filter(p => p.status === 'alive').length;
  const total = players.length;
  const waiting = players.filter(p => p.status === 'waiting').length;

  // Scale untuk HUD - lebih besar untuk visibility
  const hudScale = Math.max(0.9, Math.min(1.3, displayScale * 1.6));

  // State badge (tengah atas)
  const stateColors = {
    idle        : '#534AB7',
    lobby       : '#378ADD',
    countdown   : '#BA7517',
    green_light : '#1D9E75',
    red_light   : '#E24B4A',
    checking    : '#D85A30',
    round_end   : '#534AB7',
    game_over   : '#2C2C2A'
  };

  const stateLabels = {
    idle        : '⏳ MENUNGGU PEMAIN...',
    lobby       : '🎮 LOBBY - SIAP BERMAIN',
    countdown   : '⚡ COUNTDOWN',
    green_light : '🟢 LAMPU HIJAU — JALAN CEPAT!',
    red_light   : '🔴 LAMPU MERAH — JANGAN GERAK!',
    checking    : '👁️ MENGECEK PELANGGAR...',
    round_end   : '✨ LANJUT KE LAMPU BERIKUTNYA...',
    game_over   : '🏆 GAME SELESAI'
  };

  // Background badge state - tengah atas dengan glass effect
  const badgeW = 800;
  const badgeH = 90;
  const badgeX = (CANVAS_W / 2) - (badgeW / 2);
  const badgeY = 20;

  // Glass effect background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(badgeX - 5, badgeY - 5, badgeW + 10, badgeH + 10, 20);
  ctx.fill();

  // Gradient border
  const borderGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
  borderGrad.addColorStop(0, (stateColors[gameState] ?? '#222') + 'cc');
  borderGrad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  borderGrad.addColorStop(1, (stateColors[gameState] ?? '#222') + 'cc');
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(badgeX - 5, badgeY - 5, badgeW + 10, badgeH + 10, 20);
  ctx.stroke();

  // Main badge
  ctx.fillStyle = (stateColors[gameState] ?? '#222') + 'dd';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 18);
  ctx.fill();

  // Text label state - SANGAT BESAR
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'white';
  ctx.font = `bold 50px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stateLabels[gameState] ?? gameState, CANVAS_W / 2, badgeY + (badgeH / 2));
  ctx.shadowBlur = 0;

  // Pemain tersisa (tengah atas, di bawah state badge)
  const playerBadgeW = 500;
  const playerBadgeH = 70;
  const playerBadgeX = (CANVAS_W / 2) - (playerBadgeW / 2);
  const playerBadgeY = 125;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(playerBadgeX, playerBadgeY, playerBadgeW, playerBadgeH, 16);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(playerBadgeX, playerBadgeY, playerBadgeW, playerBadgeH, 16);
  ctx.stroke();

  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'white';
  ctx.font = `bold 40px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`👥 Players: ${alive} alive / ${total} total`, playerBadgeX + (playerBadgeW / 2), playerBadgeY + (playerBadgeH / 2));
  ctx.shadowBlur = 0;

  // Timer display
  if (gameState !== 'idle' && gameState !== 'lobby') {
    // Hitung waktu tersisa dari elapsedSeconds (lokal)
    const remaining = Math.max(0, MAX_GAME_TIME - elapsedSeconds);
    
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const isWarning = remaining <= 30;
    const isCritical = remaining <= 10;
    const timerLabel = isCritical ? `🚨 ${timeStr}` : isWarning ? `⚠️ ${timeStr}` : `⏱️ ${timeStr}`;

    const timerBadgeW = 320;
    const timerBadgeH = 60;
    const timerBadgeX = (CANVAS_W / 2) - (timerBadgeW / 2);
    const timerBadgeY = 210;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(timerBadgeX, timerBadgeY, timerBadgeW, timerBadgeH, 14);
    ctx.fill();

    ctx.strokeStyle = isWarning ? 'rgba(226,75,74,0.8)' : 'rgba(239,159,39,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(timerBadgeX, timerBadgeY, timerBadgeW, timerBadgeH, 14);
    ctx.stroke();

    ctx.shadowColor = isCritical ? 'rgba(255,0,0,0.9)' : isWarning ? 'rgba(226,75,74,0.8)' : 'rgba(239,159,39,0.6)';
    ctx.shadowBlur = isCritical ? 20 : 12;
    ctx.fillStyle = isCritical ? '#FF0000' : isWarning ? '#E24B4A' : '#EF9F27';
    ctx.font = `bold ${isCritical ? 44 : 38}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(timerLabel, timerBadgeX + (timerBadgeW / 2), timerBadgeY + (timerBadgeH / 2));
    ctx.shadowBlur = 0;

    // Pulse effect untuk critical time
    if (isCritical) {
      const pulse = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#FF0000';
      ctx.font = 'bold 36px monospace';
      ctx.fillText('⏰ WAKTU HAMPIR HABIS!', CANVAS_W / 2, timerBadgeY + timerBadgeH + 50);
      ctx.globalAlpha = 1;
    }

    // Finish counter
    const finishBadgeW = 320;
    const finishBadgeH = 60;
    const finishBadgeX = (CANVAS_W / 2) - (finishBadgeW / 2);
    const finishBadgeY = 280;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(finishBadgeX, finishBadgeY, finishBadgeW, finishBadgeH, 14);
    ctx.fill();

    ctx.strokeStyle = finishedCount >= maxFinish ? 'rgba(226,75,74,0.8)' : 'rgba(29,158,117,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(finishBadgeX, finishBadgeY, finishBadgeW, finishBadgeH, 14);
    ctx.stroke();

    ctx.shadowColor = finishedCount >= maxFinish ? 'rgba(226,75,74,0.8)' : 'rgba(29,158,117,0.6)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = finishedCount >= maxFinish ? '#E24B4A' : '#1D9E75';
    ctx.font = `bold 36px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`🏁 Finish: ${finishedCount}/${maxFinish}`, finishBadgeX + (finishBadgeW / 2), finishBadgeY + (finishBadgeH / 2));
    ctx.shadowBlur = 0;
  }

  // Countdown besar di tengah layar
  if (gameState === 'countdown' && countdownNumber !== null) {
    const countW = 280 * hudScale;
    const countH = 280 * hudScale;
    const countX = (CANVAS_W / 2) - (countW / 2);
    const countY = (CANVAS_H / 2) - (countH / 2);

    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.roundRect(countX, countY, countW, countH, 28 * hudScale);
    ctx.fill();

    ctx.strokeStyle = '#EF9F27';
    ctx.lineWidth = 6 * hudScale;
    ctx.beginPath();
    ctx.roundRect(countX, countY, countW, countH, 28 * hudScale);
    ctx.stroke();

    ctx.fillStyle = '#EF9F27';
    ctx.font = `bold ${160 * hudScale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(239,159,39,0.6)';
    ctx.shadowBlur = 25;
    ctx.fillText(countdownNumber.toString(), CANVAS_W / 2, CANVAS_H / 2);
    ctx.shadowBlur = 0;
  }

  // Winner announcement dengan efek megah
  if (gameState === 'game_over' && winner) {
    const winW = 900;
    const winH = 140;
    const winX = (CANVAS_W / 2) - (winW / 2);
    const winY = (CANVAS_H / 2) + 80;

    // Background dengan gradient emas
    const winGrad = ctx.createLinearGradient(winX, winY, winX + winW, winY + winH);
    winGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
    winGrad.addColorStop(0.5, 'rgba(239, 159, 39, 0.2)');
    winGrad.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = winGrad;
    ctx.beginPath();
    ctx.roundRect(winX, winY, winW, winH, 25);
    ctx.fill();

    // Border emas bercahaya
    ctx.shadowColor = 'rgba(239, 159, 39, 0.9)';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = '#EF9F27';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(winX, winY, winW, winH, 25);
    ctx.stroke();

    // Teks winner
    ctx.shadowBlur = 25;
    ctx.fillStyle = '#EF9F27';
    ctx.font = `bold 70px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🏆 ${winner.username} MENANG! 🏆`, CANVAS_W / 2, winY + (winH / 2));
    ctx.shadowBlur = 0;
  }
}

// ===================== BAGIAN 9: DRAW GIFT EFFECT =====================
function drawGiftEffect() {
  if (!giftEffect) return;
  if (Date.now() > giftEffect.expiry) {
    giftEffect = null;
    return;
  }

  const remaining = giftEffect.expiry - Date.now();
  const progress = 1 - (remaining / 3500);  // 0-1 progress
  const alpha = Math.min(1, remaining / 500);
  const time = Date.now() * 0.003;

  ctx.globalAlpha = alpha;

  // EFFECT TYPE: UNIVERSE (GOLDEN COSMIC SHIELD) - SUPER WOW!
  if (giftEffect.type === 'universe') {
    // Cosmic background dengan stars
    ctx.fillStyle = 'rgba(10, 5, 30, 0.85)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars particles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (let i = 0; i < 50; i++) {
      const x = (Math.sin(i * 123.456 + time * 2) * 0.5 + 0.5) * CANVAS_W;
      const y = (Math.cos(i * 789.012 + time) * 0.5 + 0.5) * CANVAS_H;
      const size = Math.sin(time + i) * 2 + 3;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Golden ring effect
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 8;
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 40;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 200 + i * 80 + Math.sin(time + i) * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Main box dengan gradient emas
    const boxW = 1000;
    const boxH = 180;
    const boxX = (CANVAS_W / 2) - (boxW / 2);
    const boxY = (CANVAS_H / 2) - (boxH / 2);

    const goldGrad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
    goldGrad.addColorStop(0, 'rgba(255, 215, 0, 0.9)');
    goldGrad.addColorStop(0.5, 'rgba(255, 223, 100, 0.8)');
    goldGrad.addColorStop(1, 'rgba(255, 215, 0, 0.9)');
    ctx.fillStyle = goldGrad;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 25);
    ctx.fill();

    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 50;
    ctx.strokeStyle = '#FFF8DC';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 25);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Text dengan glow
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 56px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌌 GOLDEN SHIELD ACTIVATED 🌌', CANVAS_W / 2, boxY + 60);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#2a1a3e';
    ctx.font = 'bold 40px monospace';
    ctx.fillText(giftEffect.pesan, CANVAS_W / 2, boxY + 120);
  }
  // EFFECT TYPE: REGULAR GIFTS
  else {
    // Background box - responsive
    const boxW = 1000;
    const boxH = 140;
    const boxX = (CANVAS_W / 2) - (boxW / 2);
    const boxY = (CANVAS_H / 2) - (boxH / 2);

    // Animated background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 20);
    ctx.fill();

    // Border accent dengan warna sesuai type
    const borderColors = {
      freeze      : '#85B7EB',
      eliminate   : '#E24B4A',
      winner      : '#EF9F27',
      shield      : '#1D9E75',
      push_back   : '#FF69B4',
      speed_boost : '#00FF7F',
      shuffle     : '#FF6347',
      confetti    : '#FFD700',
      cheap_gift  : '#87CEEB',
      lion_failed : '#888780'
    };
    
    const borderColor = borderColors[giftEffect.type] ?? 'white';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 4;
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 20);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Animated particles untuk cheap gifts
    if (['confetti', 'speed_boost', 'shuffle'].includes(giftEffect.type)) {
      ctx.fillStyle = borderColor;
      for (let i = 0; i < 15; i++) {
        const x = boxX + (progress * boxW * (i / 15));
        const y = boxY + Math.sin(time * 3 + i) * 30 + boxH / 2;
        const size = Math.sin(time + i * 0.5) * 3 + 4;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Text pesan
    ctx.fillStyle = borderColor;
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 15;
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(giftEffect.pesan, CANVAS_W / 2, boxY + (boxH / 2));
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
}

// ===================== BAGIAN 9.5: DRAW LEADERBOARD =====================
function drawLeaderboard() {
  // Hanya tampilkan saat game berlangsung (bukan idle/lobby/game_over)
  if (gameState === 'idle' || gameState === 'lobby' || gameState === 'game_over') return;

  const alivePlayers = players.filter(p => p.status === 'alive');
  if (alivePlayers.length === 0) return;

  // Sort berdasarkan posisi (tertinggi di atas)
  const sorted = [...alivePlayers].sort((a, b) => b.posisi - a.posisi);
  const top5 = sorted.slice(0, 5);

  const lbScale = Math.max(0.9, Math.min(1.3, displayScale * 1.6));
  const lbWidth = 340 * lbScale;
  const lbItemHeight = 58 * lbScale;
  const lbPadding = 10 * lbScale;
  const lbHeaderHeight = 50 * lbScale;
  const lbHeight = lbHeaderHeight + (top5.length * lbItemHeight) + (lbPadding * 2);
  
  // Posisi: KANAN atas
  const lbX = CANVAS_W - lbWidth - 10;
  const lbY = 200 * lbScale;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(lbX, lbY, lbWidth, lbHeight, 14 * lbScale);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(239, 159, 39, 0.5)';
  ctx.lineWidth = 4 * lbScale;
  ctx.beginPath();
  ctx.roundRect(lbX, lbY, lbWidth, lbHeight, 16 * lbScale);
  ctx.stroke();

  // Header
  ctx.fillStyle = '#EF9F27';
  ctx.font = `bold ${34 * lbScale}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillText('🏆 TOP 5', lbX + (lbWidth / 2), lbY + (lbHeaderHeight / 2));
  ctx.shadowBlur = 0;

  // Player items
  top5.forEach((player, index) => {
    const itemY = lbY + lbHeaderHeight + lbPadding + (index * lbItemHeight);
    const itemHeight = lbItemHeight - 6;

    // Background item (highlight untuk #1)
    if (index === 0) {
      ctx.fillStyle = 'rgba(239, 159, 39, 0.25)';
    } else {
      ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
    }
    ctx.beginPath();
    ctx.roundRect(lbX + 10, itemY, lbWidth - 20, itemHeight, 8 * lbScale);
    ctx.fill();

    // Rank number
    const rankColors = ['#EF9F27', '#C0C0C0', '#CD7F32', '#888', '#888'];
    ctx.fillStyle = rankColors[index];
    ctx.font = `bold ${22 * lbScale}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`#${index + 1}`, lbX + 14, itemY + (itemHeight / 2));

    // Avatar/initial
    const avatarX = lbX + 46 * lbScale;
    const avatarY = itemY + (itemHeight / 2);
    const avatarR = 16 * lbScale;

    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = player.color + '44';
    ctx.fill();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 3 * lbScale;
    ctx.stroke();

    // Avatar image or initial
    const avatar = avatarCache[player.uniqueId];
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarR - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, avatarX - avatarR + 2, avatarY - avatarR + 2, (avatarR - 2) * 2, (avatarR - 2) * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = player.color;
      ctx.font = `bold ${16 * lbScale}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.username[0].toUpperCase(), avatarX, avatarY);
    }

    // Username (shorter)
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `bold ${18 * lbScale}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`@${player.username.substring(0, 10)}`, lbX + 72 * lbScale, itemY + (itemHeight / 2) - 8 * lbScale);

    // Progress percentage
    const progress = Math.min(100, player.posisi).toFixed(0);
    ctx.fillStyle = player.color;
    ctx.font = `bold ${18 * lbScale}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${progress}%`, lbX + lbWidth - 12, itemY + (itemHeight / 2));
  });
}

// ===================== BAGIAN 9.6: DRAW LIKE ELIMINATION NOTIFICATION =====================
function drawLikeEliminationNotifications() {
  const now = Date.now();
  likeEliminations = likeEliminations.filter(n => now < n.expiry);

  likeEliminations.forEach((notif, index) => {
    const age = now - notif.timestamp;
    const duration = 3000;
    const progress = age / duration;
    
    // Fade in dan fade out
    let alpha = 1;
    if (progress < 0.1) alpha = progress / 0.1;
    else if (progress > 0.7) alpha = 1 - ((progress - 0.7) / 0.3);
    
    const notifScale = Math.max(0.9, Math.min(1.3, displayScale * 1.5));
    const notifY = 320 * notifScale + (index * 80 * notifScale);
    const notifHeight = 70 * notifScale;
    const notifWidth = 700 * notifScale;
    const notifX = (CANVAS_W / 2) - (notifWidth / 2);

    ctx.globalAlpha = alpha;

    // Background
    ctx.fillStyle = 'rgba(226, 75, 74, 0.92)';
    ctx.beginPath();
    ctx.roundRect(notifX, notifY, notifWidth, notifHeight, 12 * notifScale);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3 * notifScale;
    ctx.beginPath();
    ctx.roundRect(notifX, notifY, notifWidth, notifHeight, 12 * notifScale);
    ctx.stroke();

    // Text
    ctx.fillStyle = 'white';
    ctx.font = `bold ${30 * notifScale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(`🚫 @${notif.username} like saat Lampu Merah!`, CANVAS_W / 2, notifY + (notifHeight / 2));
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 1;
  });
}

// ===================== BAGIAN 9.65: DRAW FINISH NOTIFICATIONS =====================
function drawFinishNotifications() {
  if (finishNotifications.length === 0) return;

  const now = Date.now();
  finishNotifications = finishNotifications.filter(n => now < n.expiry);

  const startY = 380;
  const gap = 55;

  finishNotifications.forEach((notif, index) => {
    const remaining = notif.expiry - now;
    const alpha = Math.min(1, remaining / 500);
    const yOffset = startY + (index * gap);

    ctx.globalAlpha = alpha;

    // Rank emojis
    const rankEmojis = ['', '🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const rankEmoji = rankEmojis[notif.rank] || `#${notif.rank}`;

    // Simple contrasting text - NO background boxes
    // Rank (gold)
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${rankEmoji}`, CANVAS_W / 2 - 280, yOffset);

    // Username (bright cyan for contrast)
    ctx.fillStyle = '#00FFFF';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(`@${notif.username}`, CANVAS_W / 2 + 20, yOffset);

    // FINISH! (bright green)
    ctx.fillStyle = '#00FF66';
    ctx.fillText('FINISH!', CANVAS_W / 2 + 300, yOffset);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });
}

// ===================== BAGIAN 9.7: DRAW POST-GAME LEADERBOARD =====================
let leaderboardShown = false;  // Track apakah leaderboard sudah tampil

function drawPostGameLeaderboard() {
  if (!postGameStats) return;

  // Tampilkan saat game_over ATAU idle (menunggu pemain)
  if (gameState !== 'game_over' && gameState !== 'idle') {
    leaderboardShown = false;
    return;
  }

  // Play victory sound saat pertama kali muncul
  if (!leaderboardShown && postGameStats.topWinners && postGameStats.topWinners.length > 0) {
    leaderboardShown = true;
    if (soundEnabled) {
      sounds.winner.stop();
      sounds.winner.play();
    }
  }

  const pgScale = Math.max(0.8, Math.min(1.2, displayScale * 1.4));
  const boxWidth = 800 * pgScale;
  const boxX = (CANVAS_W / 2) - (boxWidth / 2);

  // Posisi berbeda untuk idle vs game_over
  let boxY;
  if (gameState === 'idle') {
    boxY = CANVAS_H / 2 - 320; // Di tengah atas saat menunggu
  } else {
    boxY = CANVAS_H / 2 + 150; // Di bawah saat game over
  }

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, 500 * pgScale, 16 * pgScale);
  ctx.fill();

  ctx.strokeStyle = '#EF9F27';
  ctx.lineWidth = 4 * pgScale;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, 500 * pgScale, 16 * pgScale);
  ctx.stroke();

  // Title
  ctx.fillStyle = '#EF9F27';
  ctx.font = `bold ${36 * pgScale}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  const titleText = gameState === 'idle' ? '🏆 LEADERBOARD SEMENTARA 🏆' : '🏆 LEADERBOARD 🏆';
  ctx.fillText(titleText, CANVAS_W / 2, boxY + 40 * pgScale);
  ctx.shadowBlur = 0;

  // Top Winners (Left Column)
  const leftColX = boxX + 40 * pgScale;
  let currentY = boxY + 90 * pgScale;

  ctx.fillStyle = '#EF9F27';
  ctx.font = `bold ${24 * pgScale}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('🥇 Top Winners', leftColX, currentY);
  currentY += 40 * pgScale;

  if (postGameStats.topWinners && postGameStats.topWinners.length > 0) {
    postGameStats.topWinners.slice(0, 5).forEach((player, i) => {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${20 * pgScale}px monospace`;
      ctx.fillText(`${medals[i]} @${player.username}`, leftColX, currentY);
      ctx.fillStyle = '#EF9F27';
      ctx.textAlign = 'right';
      ctx.fillText(`${player.points} pts`, boxX + boxWidth / 2 - 20 * pgScale, currentY);
      ctx.textAlign = 'left';
      currentY += 32 * pgScale;
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${18 * pgScale}px monospace`;
    ctx.fillText('Belum ada pemenang', leftColX, currentY);
  }

  // Top Gifters (Right Column)
  const rightColX = boxX + boxWidth / 2 + 20 * pgScale;
  currentY = boxY + 90 * pgScale;

  ctx.fillStyle = '#EF9F27';
  ctx.font = `bold ${24 * pgScale}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('🎁 Top Gifters', rightColX, currentY);
  currentY += 40 * pgScale;

  if (postGameStats.topGifters && postGameStats.topGifters.length > 0) {
    postGameStats.topGifters.slice(0, 5).forEach((gifter, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${20 * pgScale}px monospace`;
      ctx.fillText(`${i + 1}. @${gifter.username}`, rightColX, currentY);
      ctx.fillStyle = '#378ADD';
      ctx.textAlign = 'right';
      ctx.fillText(`${gifter.giftValue}🪙`, boxX + boxWidth - 20 * pgScale, currentY);
      ctx.textAlign = 'left';
      currentY += 32 * pgScale;
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${18 * pgScale}px monospace`;
    ctx.fillText('Belum ada gift', rightColX, currentY);
  }
  
  // Footer info saat idle
  if (gameState === 'idle') {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${16 * pgScale}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Menunggu game dimulai...', CANVAS_W / 2, boxY + 470 * pgScale);
  }
}

// ===================== BAGIAN 10: CONFETTI =====================
function spawnConfetti(player) {
  // OPTIMASI: kurangi partikel untuk mobile
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const count = isMobile ? 40 : 120;
  
  const color = player?.color ?? '#EF9F27';
  for (let i = 0; i < count; i++) {
    confettiParticles.push({
      x     : CANVAS_W / 2 + (Math.random() - 0.5) * 600,
      y     : CANVAS_H / 2,
      vy    : -(Math.random() * 8 + 4),
      vx    : (Math.random() - 0.5) * 6,
      color : color,
      size  : Math.random() * 10 + 6,
      life  : 1.0
    });
  }
}

function drawConfetti() {
  confettiParticles = confettiParticles.filter(p => p.life > 0);

  for (const p of confettiParticles) {
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.3;  // gravity
    p.life -= 0.018;

    ctx.globalAlpha = p.life;
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }

  ctx.globalAlpha = 1;
}

// ===================== BAGIAN 11: ANIMASI ELIMINASI (LEDAKAN) =====================
/**
 * Trigger animasi ledakan saat pemain tereliminasi.
 * Partikel berwarna merah/oranye menyebar dari posisi pemain.
 */
function triggerExplosion(player) {
  const cx = assignLane(player.uniqueId);
  const cy = TRACK_BOTTOM - (player.posisi / 100) * (TRACK_BOTTOM - TRACK_TOP - 60);
  const color = player.color;

  // OPTIMASI: kurangi partikel ledakan untuk mobile
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const particleCount = isMobile ? 30 : (60 + Math.floor(Math.random() * 20));
  
  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
    const speed = Math.random() * 10 + 5;
    const size = Math.random() * 12 + 6;
    
    explosionParticles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      size: size,
      color: i % 3 === 0 ? '#E24B4A' : (i % 3 === 1 ? '#FF6B35' : color),
      life: 1.0,
      decay: Math.random() * 0.02 + 0.015,
      gravity: 0.4
    });
  }

  // Flash effect (hanya desktop)
  if (!isMobile) {
    explosionParticles.push({
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      size: 80,
      color: '#FFFFFF',
      life: 0.8,
      decay: 0.08,
      gravity: 0,
      isFlash: true
    });
  }

  // Shake effect pada player
  player.opacity = 1;
  player.shakeX = 0;
  player.exploding = true;

  let shakeCount = 0;
  const shakeInterval = setInterval(() => {
    player.shakeX = (Math.random() - 0.5) * 25;
    shakeCount++;

    if (shakeCount > 8) {
      clearInterval(shakeInterval);
      player.shakeX = 0;
      player.exploding = false;
      
      // Fade out setelah ledakan
      const fadeInterval = setInterval(() => {
        player.opacity -= 0.05;
        if (player.opacity <= 0) {
          clearInterval(fadeInterval);
          player.opacity = 0;
        }
      }, 30);
    }
  }, 40);
}

/**
 * Draw partikel ledakan.
 */
function drawExplosionParticles() {
  explosionParticles = explosionParticles.filter(p => p.life > 0);

  for (const p of explosionParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.life -= p.decay;

    // Kurangi ukuran seiring waktu
    const currentSize = p.size * p.life;

    ctx.globalAlpha = p.life;
    
    if (p.isFlash) {
      // Flash effect - lingkaran putih besar
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Partikel biasa - kotak dengan rotasi
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.life * Math.PI * 4);
      ctx.fillRect(-currentSize / 2, -currentSize / 2, currentSize, currentSize);
      ctx.restore();
    }
  }

  ctx.globalAlpha = 1;
}

// ===================== BAGIAN 11.5: ANIMASI ELIMINASI LAMA (KEPUL ASAP) =====================
/**
 * Trigger eliminasi biasa (bukan ledakan).
 * Fade out dengan efek asap.
 */
function triggerEliminate(player) {
  player.opacity = 1;
  player.shakeX = 0;

  let shakeCount = 0;
  const shakeInterval = setInterval(() => {
    player.shakeX = (Math.random() - 0.5) * 18;
    shakeCount++;

    if (shakeCount > 10) {
      clearInterval(shakeInterval);
      player.shakeX = 0;

      // Fade out
      const fadeInterval = setInterval(() => {
        player.opacity -= 0.04;
        if (player.opacity <= 0) {
          clearInterval(fadeInterval);
          player.opacity = 0;
        }
      }, 40);
    }
  }, 50);
}

// ===================== BAGIAN 12: SOUND SETUP =====================
// Sound effects only: victory, transition, elimination
const sounds = {
  eliminated : new Howl({ src: ['sounds/eliminated.mp3'], volume: 0.7, preload: true }),
  winner     : new Howl({ src: ['sounds/winner.mp3'],     volume: 1.0, preload: true }),
  ting       : new Howl({ src: ['sounds/ting.mp3'], volume: 0.9, preload: true })  // Sound transisi lampu
};

// Debug: log saat sound load/error
Object.entries(sounds).forEach(([name, sound]) => {
  sound.on('loaderror', (err) => {
    console.error(`[Sound] ❌ Error loading ${name}:`, err);
  });
  sound.on('load', () => {
    console.log(`[Sound] ✅ Loaded: ${name}`);
  });
});

// Enable sound setelah user interaction (browser policy)
let soundEnabled = false;
document.addEventListener('click', () => {
  if (!soundEnabled) {
    soundEnabled = true;
    console.log('[Sound] 🔊 Audio unlocked!');
  }
}, { once: true });

// ===================== BAGIAN 13: GAME RENDER LOOP =====================

function loop() {
  try {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    frameCount++;

    drawBackground();
    drawLamp(gameState === 'red_light' || gameState === 'checking');

    // OPTIMASI: batch draw players
    const eliminatedPlayers = players.filter(p => p.status === 'eliminated' && p.opacity > 0);
    const alivePlayers = players.filter(p => p.status !== 'eliminated');

    // PERFORMANCE: Skip eliminated players saat 100+ players
    const ultraMany = players.length > 100;
    if (ultraMany) {
      for (let i = 0; i < alivePlayers.length; i++) {
        drawStickman(alivePlayers[i]);
      }
    } else {
      for (let i = 0; i < eliminatedPlayers.length; i++) {
        drawStickman(eliminatedPlayers[i]);
      }
      for (let i = 0; i < alivePlayers.length; i++) {
        drawStickman(alivePlayers[i]);
      }
    }

    drawHUD();
    drawLeaderboard();
    drawGiftEffect();
    drawConfetti();
    drawExplosionParticles();
    drawLikeEliminationNotifications();
    drawFinishNotifications();
    drawPostGameLeaderboard();

    // Debug info (pojok kiri bawah)
    ctx.fillStyle = socketConnected ? 'rgba(29, 158, 117, 0.8)' : 'rgba(226, 75, 74, 0.8)';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(socketConnected ? '🟢 Connected' : '🔴 Disconnected', 30, CANVAS_H - 30);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '24px monospace';
    ctx.fillText(`Players: ${players.length} | State: ${gameState}`, 30, CANVAS_H - 65);
  } catch (err) {
    console.error('[Game Loop Error]', err);
  }

  requestAnimationFrame(loop);
}

// Start render loop
loop();

// ===================== BAGIAN 14: SOCKET LISTENERS =====================

// Connection status display
let socketConnected = false;

// Request stats saat pertama kali connect
setTimeout(() => {
  socket.emit('stats:get');
}, 500);

// Socket connection events
socket.on('connect', () => {
  socketConnected = true;
  console.log(`[Overlay] ✅ Connected to server! Socket ID: ${socket.id}`);
});

socket.on('disconnect', () => {
  socketConnected = false;
  console.log('[Overlay] ❌ Disconnected from server!');
});

socket.on('connect_error', (err) => {
  console.error('[Overlay] ❌ Connection error:', err.message);
});

// State update dari server
let lastStateChangeTime = 0;  // Track time saat state berubah

socket.on('state:update', data => {
  const oldState = gameState;
  const stateActuallyChanged = (data.state !== gameState);
  const timeSinceLastChange = Date.now() - lastStateChangeTime;
  
  gameState = data.state;

  // Play "ting" sound HANYA saat state BENAR-BENAR berubah
  // Minimal 2 detik antara transisi (mencegah double trigger)
  if (soundEnabled && stateActuallyChanged && (data.state === 'green_light' || data.state === 'red_light')) {
    if (timeSinceLastChange > 2000) {  
      lastStateChangeTime = Date.now();
      sounds.ting.stop();
      sounds.ting.play();
      console.log(`[Overlay] 🔔 Ting! ${oldState} → ${data.state}`);
    }
  }

  // Update timer & finish counter
  if (data.elapsed !== undefined) elapsedSeconds = data.elapsed;
  if (data.finishedCount !== undefined) finishedCount = data.finishedCount;
  if (data.maxFinish !== undefined) maxFinish = data.maxFinish;

  // Request stats saat idle atau game_over
  if (data.state === 'idle' || data.state === 'game_over') {
    socket.emit('stats:get');
  }

  if (data.players) {
    // Update players array
    const existingMap = {};
    players.forEach(p => { existingMap[p.uniqueId] = p; });

    players = data.players.map(p => {
      const existing = existingMap[p.uniqueId];
      return {
        ...existing,  // keep existing animation state (opacity, shakeX)
        ...p,         // override with latest data
        opacity : existing?.opacity ?? 1,
        shakeX  : existing?.shakeX ?? 0,
        phase   : existing?.phase ?? (laneMap[p.uniqueId]
          ? (laneMap[p.uniqueId] % (Math.PI * 2))
          : Math.random() * Math.PI * 2)
      };
    });

    // Load avatar untuk pemain baru
    data.players.forEach(p => {
      if (!avatarCache[p.uniqueId]) {
        loadAvatar(p);
        assignLane(p.uniqueId);
      }
    });
  }

  // Jika ada winner di data
  if (data.state === 'game_over' && data.winner) {
    winner = data.winner;
    // Request post-game stats
    socket.emit('stats:get');
  }

  console.log(`[Overlay] State: ${data.state}`);
});

// Pemain bergabung
socket.on('player:joined', player => {
  const exists = players.find(p => p.uniqueId === player.uniqueId);
  if (!exists) {
    players.push({
      ...player,
      opacity: 1,
      shakeX: 0,
      phase: Math.random() * Math.PI * 2
    });
    loadAvatar(player);
    assignLane(player.uniqueId);
    console.log(`[Overlay] Player joined: ${player.username}`);
  }
});

// Pemain tereliminasi
socket.on('player:eliminated', data => {
  const p = players.find(p => p.uniqueId === data.player.uniqueId);
  if (p) {
    p.status = 'eliminated';

    // Semua eliminasi pakai sound yang sama
    triggerEliminate(p);
    if (soundEnabled) {
      sounds.eliminated.stop();
      sounds.eliminated.play();
    }
    console.log(`[Overlay] Player eliminated: ${data.player.username}`);
  }
});

// Ada pemenang
socket.on('player:winner', data => {
  // Hanya tampilkan winner announcement untuk winner sejati (bukan yang finish duluan)
  // Jika game state masih green_light/red_light, ini player finish pertama
  // Jika game_over, ini winner announcement
  if (data.player) {
    const isActualWinner = gameState === 'game_over';
    
    if (isActualWinner) {
      // Winner announcement - ini winner sejati
      winner = data.player;
      
      // Update player status
      const p = players.find(p => p.uniqueId === data.player.uniqueId);
      if (p) p.status = 'winner';

      spawnConfetti(winner);
      
      if (soundEnabled) {
        sounds.winner.stop();
        sounds.winner.play();
      }
      console.log('[Overlay] 🏆 Winner announced!');
    } else {
      // Player cuma finish (bukan winner akhir)
      const rank = finishedCount;
      console.log(`[Overlay] 🏁 Player ${data.player.username} finish di posisi #${rank}!`);
    }
  }
});

// Player finish (bukan winner akhir, cuma yang sampai finish duluan)
socket.on('player:finished', data => {
  // Tambahkan notifikasi finish
  finishNotifications.push({
    username: data.username,
    rank: data.rank,
    timestamp: Date.now(),
    expiry: Date.now() + 4000  // 4 detik
  });

  // Update posisi player
  const p = players.find(p => p.uniqueId === data.uniqueId);
  if (p) {
    p.posisi = 100;
    p.status = 'winner';
  }

  console.log(`[Overlay] 🏁 #${data.rank} @${data.username} FINISH!`);
});

// Gift effect (visual only, no sound)
socket.on('gift:effect', data => {
  giftEffect = { ...data, expiry: Date.now() + 3500 };
  console.log(`[Overlay] Gift effect: ${data.type} — ${data.pesan}`);
});

// Countdown (visual only, no sound)
socket.on('countdown', data => {
  countdownNumber = data.angka;
  console.log(`[Overlay] ⏰ Countdown received: ${data.angka}`);
});

// Player bergerak karena LIKE/TAP
socket.on('player:moved', data => {
  const p = players.find(p => p.uniqueId === data.uniqueId);
  if (p) {
    p.posisi = data.posisi;

    // Tampilkan efek boost sesaat
    p.boostFlash = 1.0; // opacity untuk efek flash

    if (data.finished) {
      console.log(`[Overlay] 🏆 ${data.username} FINISH via LIKE!`);
    }
  }
  console.log(`[Overlay] 👍 ${data.username} move to ${data.posisi.toFixed(1)}%`);
});

// Player tereliminasi karena like saat lampu merah
socket.on('player:likeEliminated', data => {
  const p = players.find(p => p.uniqueId === data.uniqueId);
  if (p) {
    p.status = 'eliminated';
    triggerExplosion(p);
    if (soundEnabled) {
      sounds.eliminated.stop();
      sounds.eliminated.play();
    }
    console.log(`[Overlay] 💥 @${data.username} eliminated for liking during red light!`);
  }

  // Tambahkan notifikasi
  likeEliminations.push({
    username: data.username,
    timestamp: Date.now(),
    expiry: Date.now() + 3000
  });
});

// TikTok connection status
socket.on('tiktok:status', data => {
  console.log(`[Overlay] TikTok status: ${data.status}`);
});

// Post-game stats
socket.on('stats:postgame', data => {
  postGameStats = data;
  console.log('[Overlay] 📊 Post-game stats received:', data);
  if (data.topWinners) {
    console.log(`[Overlay] 🏆 Top winners: ${data.topWinners.length}`);
  }
});

// Join waiting notification
socket.on('join:waiting', data => {
  console.log(`[Overlay] ⏳ ${data.username} masuk waiting list.`);
});

// Debug: log all socket events
socket.onAny((eventName, ...args) => {
  console.log(`[Socket Debug] ${eventName}`, args);
});

// ===================== POLYFILL: roundRect =====================
// Untuk browser yang belum support CanvasRenderingContext2D.roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
    const r = typeof radii === 'number' ? radii : (radii[0] || 0);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

// ===================== CAMERA SUPPORT =====================
const cameraContainer = document.getElementById('cameraContainer');
const cameraVideo = document.getElementById('cameraVideo');
const cameraClose = document.getElementById('cameraClose');
let cameraStream = null;
let cameraDragging = false;
let cameraOffset = { x: 0, y: 0 };

// Load saved camera position
function loadCameraPosition() {
  try {
    const saved = localStorage.getItem('cameraPos');
    if (saved) {
      const pos = JSON.parse(saved);
      cameraContainer.style.left = pos.x + 'px';
      cameraContainer.style.top = pos.y + 'px';
      cameraContainer.style.width = (pos.w || 320) + 'px';
      cameraContainer.style.height = (pos.h || 240) + 'px';
      cameraContainer.style.bottom = 'auto';
      cameraContainer.style.right = 'auto';
    }
  } catch (e) {}
}

// Save camera position
function saveCameraPosition() {
  try {
    const rect = cameraContainer.getBoundingClientRect();
    localStorage.setItem('cameraPos', JSON.stringify({
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height
    }));
  } catch (e) {}
}

// Start camera
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraContainer.classList.add('active');
    loadCameraPosition();
    console.log('[Camera] ✅ Camera started');
  } catch (err) {
    console.error('[Camera] ❌ Error:', err);
    alert('Tidak bisa mengakses kamera. Pastikan browser memiliki izin.');
  }
}

// Stop camera
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraContainer.classList.remove('active');
  console.log('[Camera] ⏹️ Camera stopped');
}

// Camera drag functionality
cameraContainer.addEventListener('mousedown', (e) => {
  if (e.target === cameraClose) return;
  cameraDragging = true;
  cameraOffset.x = e.clientX - cameraContainer.offsetLeft;
  cameraOffset.y = e.clientY - cameraContainer.offsetTop;
});

cameraContainer.addEventListener('touchstart', (e) => {
  if (e.target === cameraClose) return;
  cameraDragging = true;
  const touch = e.touches[0];
  cameraOffset.x = touch.clientX - cameraContainer.offsetLeft;
  cameraOffset.y = touch.clientY - cameraContainer.offsetTop;
});

document.addEventListener('mousemove', (e) => {
  if (!cameraDragging) return;
  cameraContainer.style.left = (e.clientX - cameraOffset.x) + 'px';
  cameraContainer.style.top = (e.clientY - cameraOffset.y) + 'px';
  cameraContainer.style.bottom = 'auto';
  cameraContainer.style.right = 'auto';
});

document.addEventListener('touchmove', (e) => {
  if (!cameraDragging) return;
  const touch = e.touches[0];
  cameraContainer.style.left = (touch.clientX - cameraOffset.x) + 'px';
  cameraContainer.style.top = (touch.clientY - cameraOffset.y) + 'px';
  cameraContainer.style.bottom = 'auto';
  cameraContainer.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
  if (cameraDragging) {
    cameraDragging = false;
    saveCameraPosition();
  }
});

document.addEventListener('touchend', () => {
  if (cameraDragging) {
    cameraDragging = false;
    saveCameraPosition();
  }
});

// Close button
cameraClose.addEventListener('click', stopCamera);

// Listen for camera toggle from dashboard
socket.on('camera:toggle', async (data) => {
  if (data.enabled) {
    await startCamera();
  } else {
    stopCamera();
  }
});
