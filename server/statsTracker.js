/**
 * statsTracker.js
 * Track poin, gifter, dan winner statistics.
 * Akumulasi per game:
 * - Juara 1: 150 poin
 * - Juara 2: 75 poin
 * - Juara 3: 30 poin
 * - Gifter: track total gift yang dikirim
 */

// ===================== STATE =====================
const playerStats = new Map(); // uniqueId → { username, wins, points, giftsSent, giftValue }
const gameHistory = [];        // Array of game results

/**
 * Init atau get player stats
 */
function getOrCreatePlayer(uniqueId, username) {
  if (!playerStats.has(uniqueId)) {
    playerStats.set(uniqueId, {
      uniqueId,
      username,
      wins: 0,
      points: 0,
      giftsSent: 0,
      giftValue: 0,
      gamesPlayed: 0
    });
  } else if (username) {
    // Update username jika berubah
    const stats = playerStats.get(uniqueId);
    stats.username = username;
  }
  return playerStats.get(uniqueId);
}

/**
 * Tambah poin setelah game selesai
 */
function addPoints(uniqueId, points, reason = 'game') {
  const stats = getOrCreatePlayer(uniqueId);
  stats.points += points;
  console.log(`[StatsTracker] +${points} poin untuk ${stats.username} (${reason}) → Total: ${stats.points}`);
  return stats;
}

/**
 * Record winner (juara 1)
 */
function recordWinner(uniqueId, username) {
  const stats = getOrCreatePlayer(uniqueId, username);
  stats.wins++;
  stats.gamesPlayed++;
  addPoints(uniqueId, 150, 'juara_1');
  
  console.log(`[StatsTracker] 🏆 ${username} menang! Win #${stats.wins}, Total Poin: ${stats.points}`);
  
  return stats;
}

/**
 * Record runner-up (juara 2)
 */
function recordRunnerUp(uniqueId, username) {
  const stats = getOrCreatePlayer(uniqueId, username);
  stats.gamesPlayed++;
  addPoints(uniqueId, 75, 'juara_2');
  return stats;
}

/**
 * Record juara 3
 */
function recordThirdPlace(uniqueId, username) {
  const stats = getOrCreatePlayer(uniqueId, username);
  stats.gamesPlayed++;
  addPoints(uniqueId, 30, 'juara_3');
  return stats;
}

/**
 * Record gift sent
 */
function recordGift(uniqueId, username, giftName, coinValue) {
  const stats = getOrCreatePlayer(uniqueId, username);
  stats.giftsSent++;
  stats.giftValue += coinValue;
  console.log(`[StatsTracker] 🎁 ${username} kirim ${giftName} (${coinValue} koin). Total gifts: ${stats.giftsSent}, Value: ${stats.giftValue}`);
  return stats;
}

/**
 * Get top players by points
 */
function getTopPlayers(limit = 10) {
  return Array.from(playerStats.values())
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/**
 * Get top gifters by total gift value
 */
function getTopGifters(limit = 10) {
  return Array.from(playerStats.values())
    .filter(p => p.giftsSent > 0)
    .sort((a, b) => b.giftValue - a.giftValue)
    .slice(0, limit);
}

/**
 * Get all stats untuk post-game leaderboard
 */
function getPostGameStats() {
  const topWinners = getTopPlayers(5);
  const topGifters = getTopGifters(5);
  
  return {
    topWinners,
    topGifters,
    totalGames: gameHistory.length,
    totalPlayers: playerStats.size
  };
}

/**
 * Reset stats (jika diperlukan)
 */
function resetStats() {
  playerStats.clear();
  gameHistory.length = 0;
  console.log('[StatsTracker] Stats direset.');
}

/**
 * Get single player stats
 */
function getPlayerStats(uniqueId) {
  return playerStats.get(uniqueId) || null;
}

// ===================== EXPORTS =====================
module.exports = {
  getOrCreatePlayer,
  addPoints,
  recordWinner,
  recordRunnerUp,
  recordThirdPlace,
  recordGift,
  getTopPlayers,
  getTopGifters,
  getPostGameStats,
  resetStats,
  getPlayerStats
};
