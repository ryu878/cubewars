// Tester (Trusya) live combat regression: connects a raw WS client to
// "bots" mode, actively aims (yaw+pitch computed from the server's own
// authoritative bot position, exactly like a real player would after
// looking at their screen) at a bot at CLOSE range and fires repeatedly,
// then backs off to LONG range and fires again — recording HitEvent/
// KillEvent/ScoreboardMessage traffic to give live evidence (not just the
// statistical regression script) of: damage values (EPIC 10 rebalance),
// armor absorption if any, kill feed + scoreboard events (EPIC 5), and
// bot miss behavior at range vs close (EPIC 11 Story 11.4).

import WebSocket from "ws";

const URL = "ws://127.0.0.1:7777";

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}
function waitFor(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}
function yawTowards(dx, dz) {
  return Math.atan2(-dx, -dz);
}

async function main() {
  const ws = await connect();
  let playerId = null;
  let lastState = null;
  const events = { hits: [], deaths: [], kills: [], scoreboards: [] };

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") playerId = msg.playerId;
    if (msg.type === "world_state") lastState = msg;
    if (msg.type === "hit") events.hits.push(msg);
    if (msg.type === "death") events.deaths.push(msg);
    if (msg.type === "kill") events.kills.push(msg);
    if (msg.type === "scoreboard") events.scoreboards.push(msg);
  });

  await waitFor(ws, (m) => m.type === "welcome");
  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");
  console.log("connected + joined bots mode, playerId=", playerId);

  const sendInput = (moveForward, moveRight, yaw, pitch, jump) =>
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  const fire = () => ws.send(JSON.stringify({ type: "fire" }));
  const getSelf = () => lastState.players.find((p) => p.id === playerId);
  const getBots = () => lastState.players.filter((p) => p.id !== playerId && p.alive);
  const nearestBot = () => {
    const self = getSelf();
    const bots = getBots();
    if (bots.length === 0) return null;
    let best = bots[0];
    let bestD = Infinity;
    for (const b of bots) {
      const d = Math.hypot(b.position.x - self.position.x, b.position.z - self.position.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return { bot: best, dist: bestD };
  };

  await new Promise((r) => setTimeout(r, 300));

  // Aim continuously at the nearest bot and hold fire for a while, tracking
  // range as we go (starts wherever the bot happened to be relative to us).
  async function fightFor(ms, label) {
    const hitsBefore = events.hits.filter((h) => h.shooterId === playerId).length;
    let fireAttempts = 0;
    const t = setInterval(() => {
      const found = nearestBot();
      if (!found) return;
      const self = getSelf();
      const dx = found.bot.position.x - self.position.x;
      const dz = found.bot.position.z - self.position.z;
      const dy = found.bot.position.y - self.position.y;
      const horiz = Math.hypot(dx, dz);
      const yaw = yawTowards(dx, dz);
      const pitch = Math.atan2(dy, Math.max(0.001, horiz));
      sendInput(0, 0, yaw, pitch, false);
    }, 33);
    const fireTimer = setInterval(() => {
      if (nearestBot()) {
        fire();
        fireAttempts++;
      }
    }, 320); // just above pistol's 300ms cooldown
    await new Promise((r) => setTimeout(r, ms));
    clearInterval(t);
    clearInterval(fireTimer);
    const hitsAfter = events.hits.filter((h) => h.shooterId === playerId).length;
    const landed = hitsAfter - hitsBefore;
    const found = nearestBot();
    console.log(
      `[${label}] fired ~${fireAttempts} times, ${landed} landed as confirmed hits (${((landed / Math.max(1, fireAttempts)) * 100).toFixed(1)}% observed hit rate), current range to nearest bot ~${found ? found.dist.toFixed(1) : "n/a"}m`,
    );
    return { fireAttempts, landed };
  }

  console.log("\n--- CLOSE RANGE engagement (approach + fire) ---");
  // Approach: move toward the bot for a couple seconds first.
  const approachTimer = setInterval(() => {
    const found = nearestBot();
    if (!found) return;
    const self = getSelf();
    const yaw = yawTowards(found.bot.position.x - self.position.x, found.bot.position.z - self.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, 2500));
  clearInterval(approachTimer);
  sendInput(0, 0, 0, 0, false);
  await new Promise((r) => setTimeout(r, 200));
  const closeResult = await fightFor(4000, "CLOSE");

  console.log("\n--- Back off to LONG range, then fire from distance ---");
  // Move directly away from the bot for several seconds.
  const retreatTimer = setInterval(() => {
    const found = nearestBot();
    if (!found) return;
    const self = getSelf();
    // yaw away from bot = yaw towards the negated direction
    const yaw = yawTowards(self.position.x - found.bot.position.x, self.position.z - found.bot.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, 2500));
  clearInterval(retreatTimer);
  sendInput(0, 0, 0, 0, false);
  await new Promise((r) => setTimeout(r, 200));
  const longResult = await fightFor(5000, "LONG");

  console.log("\n=== Event summary ===");
  console.log("Total HitEvents observed (any shooter):", events.hits.length);
  console.log(
    "Sample hit damages (any shooter/target):",
    events.hits.slice(0, 10).map((h) => h.damage),
  );
  console.log("DeathEvents:", events.deaths.length, JSON.stringify(events.deaths));
  console.log("KillEvents:", events.kills.length, JSON.stringify(events.kills));
  console.log("ScoreboardMessages received:", events.scoreboards.length);
  if (events.scoreboards.length) console.log("Last scoreboard:", JSON.stringify(events.scoreboards[events.scoreboards.length - 1]));
  console.log("Final self state:", getSelf());

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
