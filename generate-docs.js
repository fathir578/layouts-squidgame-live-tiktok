const XLSX = require('xlsx');

// ===================== SHEET 1: GAME ENGINE =====================
const gameEngineData = [
  ['Fitur', 'Deskripsi'],
  ['State Machine', 'IDLE → LOBBY → COUNTDOWN → GREEN LIGHT → RED LIGHT → CHECKING → ROUND END → GAME OVER'],
  ['Random Lamp Durations', 'Green Light: 2-7 detik, Red Light: 1.5-6 detik'],
  ['Auto-Restart', 'Game otomatis restart ke IDLE setelah 3 detik game over'],
  ['Timer Limit', 'Game otomatis berakhir setelah 180 detik (3 menit)'],
  ['Finish Tracking', 'Max 10 pemain pertama yang finish, sisanya eliminasi'],
  ['Max Players', '150 pemain per game'],
  ['Random Spawn', 'Pemain spawn random di seluruh track width'],
  ['Kembali ke START', 'Player yang like saat lampu merah kembali ke start (bukan eliminasi)'],
  ['Waiting System', 'Player join langsung masuk game tanpa waiting list'],
];

// ===================== SHEET 2: GIFT EFFECTS =====================
const giftEffectsData = [
  ['Gift', 'Harga (Koin)', 'Efek'],
  ['Rose', '1', '❄️ Freeze semua pemain 5 detik'],
  ['GG', '1', '🎮 Confetti kecil + semangat'],
  ['Love', '1', '❤️ Mundurkan 2 pemain random 10%'],
  ['Coffee', '1', '☕ Speed boost semua pemain 3-8%'],
  ['Hey', '1', '👋 Random shuffle posisi semua pemain'],
  ['MoneyGun', '99', '🔫 Eliminasi 2 pemain random'],
  ['TikTok', '199', '📱 Eliminasi 1 pemain random'],
  ['Paus', '2,150', '🌊 TSUNAMI! Eliminasi 3 pemain random'],
  ['Lion', '20,000', '🦁 Pengirim langsung MENANG'],
  ['Universe', '44,999', '🛡️ GOLDEN SHIELD! Semua pemain selamat 1 ronde + cosmic animation'],
];

// ===================== SHEET 3: LIKE/TAP SYSTEM =====================
const likeSystemData = [
  ['Fitur', 'Deskripsi'],
  ['Like saat Green Light', 'Player maju +0.15% + bonus (max +2.0% per like)'],
  ['Like saat Red Light', '🔄 Player kembali ke START (posisi = 0%)'],
  ['Multi-tap', 'LikeCount boost movement'],
  ['Anti-Cheat', 'Like tidak berpengaruh saat state selain green/red light'],
];

// ===================== SHEET 4: TIKTOK INTEGRATION =====================
const tiktokData = [
  ['Fitur', 'Deskripsi'],
  ['Auto-Connect', 'Connect ke TikTok Live via username'],
  ['Comment Detection', 'Viewer comment "join" → masuk game'],
  ['Gift Detection', 'Otomatis detect & process gift'],
  ['Like Detection', 'Otomatis detect like/tap'],
  ['Auto-Reconnect', 'Exponential backoff (5s, 10s, 20s)'],
  ['Manual Connect/Disconnect', 'Via dashboard'],
];

// ===================== SHEET 5: OVERLAY FEATURES =====================
const overlayData = [
  ['Fitur', 'Deskripsi'],
  ['Canvas Rendering', 'Top-down stickman view dengan avatar TikTok'],
  ['Squid Game Theme', 'Sky biru-putih, dinding putih, track pasir'],
  ['Animated Background', 'Rumput hijau bergoyang + bunga warna-warni'],
  ['Squid Game Shapes', '○△□☆ di langit'],
  ['Neon Track Border', 'Hijau saat green light, merah saat red light'],
  ['HUD Lengkap', 'State badge, player count, timer countdown, finish counter'],
  ['Top 5 Leaderboard', 'Muncul saat game berjalan'],
  ['Finish Notifications', 'Notifikasi contrasting text (hijau finish, merah reset)'],
  ['Post-Game Leaderboard', 'Top winners + top gifters setelah game over'],
  ['Host Camera', 'Webcam overlay dengan drag & drop, posisi tersimpan'],
  ['Sound Effects', 'Ting (transisi), Eliminated, Winner'],
  ['Responsive Scaling', 'Auto-scale ke ukuran layar OBS'],
];

// ===================== SHEET 6: DASHBOARD FEATURES =====================
const dashboardData = [
  ['Fitur', 'Deskripsi'],
  ['Start Game', 'Mulai game dari IDLE → LOBBY'],
  ['Reset Game', 'Reset ke IDLE'],
  ['Force Green Light', 'Manual override ke green light'],
  ['Force Red Light', 'Manual override ke red light'],
  ['Kick Player', 'Eliminasi player manual'],
  ['TikTok Config', 'Connect/disconnect TikTok Live'],
  ['Real-time Stats', 'Total players, alive, eliminated, finish, timer'],
  ['Player List', 'Daftar semua pemain dengan avatar & status'],
  ['Activity Log', 'Log semua event real-time'],
  ['Error Notifications', 'Toast notifications untuk error/warning'],
  ['Camera Toggle', 'Nyalakan/matikan kamera host'],
];

// ===================== SHEET 7: STATS TRACKER =====================
const statsData = [
  ['Fitur', 'Deskripsi'],
  ['Win Tracking', 'Record semua winner dengan poin (150 pts)'],
  ['Runner-up Tracking', 'Juara 2 (75 pts), Juara 3 (30 pts)'],
  ['Finish Points', 'Rank 4-10 dapat poin (10-30 pts)'],
  ['Gift Tracking', 'Record gifts yang dikirim + nilai koin'],
  ['Top Winners', 'Top 5 players by points'],
  ['Top Gifters', 'Top 5 gifters by coin value'],
  ['Post-Game Stats', 'Stats lengkap setelah game over'],
];

// ===================== SHEET 8: DEBUG ENDPOINTS =====================
const debugData = [
  ['Endpoint', 'Method', 'Deskripsi'],
  ['/debug/join', 'POST', 'Tambah pemain manual'],
  ['/debug/gift', 'POST', 'Trigger gift effect manual'],
  ['/debug/like', 'POST', 'Trigger like/movement manual'],
  ['/debug/state', 'POST/GET', 'Set/get state manual'],
  ['/debug/players', 'GET', 'Lihat semua pemain'],
];

// ===================== SHEET 9: PRICING =====================
const pricingData = [
  ['Paket', 'Fitur', 'Harga (USD)'],
  ['Basic', 'Game + Overlay + Dashboard', '$500 - $800'],
  ['Pro', '+ TikTok Integration + Gifts', '$1,200 - $1,800'],
  ['Premium', '+ Camera + Stats + Optimizations', '$2,000 - $3,000'],
  ['Full Source Code', 'Semua fitur + source code', '$3,500 - $5,000'],
];

// ===================== CREATE WORKBOOK =====================
const wb = XLSX.utils.book_new();

// Add sheets
const ws1 = XLSX.utils.aoa_to_sheet(gameEngineData);
const ws2 = XLSX.utils.aoa_to_sheet(giftEffectsData);
const ws3 = XLSX.utils.aoa_to_sheet(likeSystemData);
const ws4 = XLSX.utils.aoa_to_sheet(tiktokData);
const ws5 = XLSX.utils.aoa_to_sheet(overlayData);
const ws6 = XLSX.utils.aoa_to_sheet(dashboardData);
const ws7 = XLSX.utils.aoa_to_sheet(statsData);
const ws8 = XLSX.utils.aoa_to_sheet(debugData);
const ws9 = XLSX.utils.aoa_to_sheet(pricingData);

// Set column widths for better readability
function setWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

setWidths(ws1, [30, 90]);
setWidths(ws2, [15, 18, 65]);
setWidths(ws3, [30, 70]);
setWidths(ws4, [30, 70]);
setWidths(ws5, [30, 70]);
setWidths(ws6, [30, 70]);
setWidths(ws7, [30, 70]);
setWidths(ws8, [20, 15, 40]);
setWidths(ws9, [20, 40, 20]);

XLSX.utils.book_append_sheet(wb, ws1, 'Game Engine');
XLSX.utils.book_append_sheet(wb, ws2, 'Gift Effects');
XLSX.utils.book_append_sheet(wb, ws3, 'Like Tap System');
XLSX.utils.book_append_sheet(wb, ws4, 'TikTok Integration');
XLSX.utils.book_append_sheet(wb, ws5, 'Overlay Features');
XLSX.utils.book_append_sheet(wb, ws6, 'Dashboard Features');
XLSX.utils.book_append_sheet(wb, ws7, 'Stats Tracker');
XLSX.utils.book_append_sheet(wb, ws8, 'Debug Endpoints');
XLSX.utils.book_append_sheet(wb, ws9, 'Pricing Packages');

// Write file
XLSX.writeFile(wb, '/home/fathir/squid-game/TikTok-Squid-Game-Documentation.xlsx');

console.log('✅ Excel file created successfully!');
console.log('📁 File: /home/fathir/squid-game/TikTok-Squid-Game-Documentation.xlsx');
console.log('📊 Sheets:');
wb.SheetNames.forEach((name, i) => {
  console.log(`  ${i + 1}. ${name}`);
});
