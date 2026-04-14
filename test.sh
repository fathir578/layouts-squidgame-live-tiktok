#!/bin/bash
# Test script: Add players and test game flow

BASE_URL="http://localhost:3000"

echo "========================================="
echo "🎮 TikTok Red Light Green Light - Test"
echo "========================================="
echo ""

# Test 1: Add 5 players
echo "📝 TEST 1: Adding 5 players..."
for i in $(seq 1 5); do
  echo ""
  echo "--- Adding Player $i ---"
  curl -s -X POST "$BASE_URL/debug/join" \
    -H "Content-Type: application/json" \
    -d "{\"uniqueId\":\"tiktok_user_$i\",\"username\":\"Viewer_$i\",\"avatarUrl\":\"\"}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print(f'  ❌ Error: {data[\"error\"]}')
else:
    print(f'  ✅ {data[\"username\"]} joined!')
    print(f'     Color: {data[\"color\"]}')
    print(f'     Speed: {data[\"kecepatan\"]}')
    print(f'     Position: {data[\"posisi\"]}%')
    print(f'     Status: {data[\"status\"]}')
"
  sleep 0.2
done

echo ""
echo "========================================="

# Test 2: Check all players
echo ""
echo "👥 TEST 2: Checking all players..."
curl -s "$BASE_URL/debug/players" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'  Total: {data[\"total\"]} players')
print(f'  Alive: {data[\"alive\"]} players')
print(f'  Waiting: {data[\"waiting\"]} players')
"

echo ""
echo "========================================="

# Test 3: Start game
echo ""
echo "▶️  TEST 3: Starting game..."
curl -s -X POST "$BASE_URL/debug/state" \
  -H "Content-Type: application/json" \
  -d '{"state":"lobby"}' | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'  State: {data[\"state\"]}')
print(f'  Players: {data[\"players\"]}')
"

echo ""
echo "========================================="

# Test 4: Test gift
echo ""
echo "🎁 TEST 4: Testing Rose gift..."
curl -s -X POST "$BASE_URL/debug/gift" \
  -H "Content-Type: application/json" \
  -d '{"giftName":"Rose","uniqueId":"tiktok_user_1"}' | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'  Success: {data[\"success\"]}')
print(f'  Gift: {data[\"gift\"]}')
"

echo ""
echo "========================================="
echo ""
echo "✅ All tests completed!"
echo ""
echo "📺 Buka overlay: http://localhost:3000/overlay/index.html"
echo "🎛️ Buka dashboard: http://localhost:3000/dashboard/index.html"
echo ""
