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
  const hits = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") playerId = msg.playerId;
    if (msg.type === "world_state") lastState = msg;
    if (msg.type === "hit" && msg.targetId === playerId) hits.push(msg);
  });
  await waitFor(ws, (m) => m.type === "welcome");
  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");

  const sendInput = (moveForward, moveRight, yaw, pitch, jump) =>
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  const getSelf = () => lastState.players.find((p) => p.id === playerId);

  console.log("spawn:", getSelf().position);
  const target = { x: 10, z: 16 }; // armor_tunnel_east
  console.log("navigating to armor pickup at", target);

  const nav = setInterval(() => {
    const self = getSelf();
    const yaw = yawTowards(target.x - self.position.x, target.z - self.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, 3500));
  clearInterval(nav);
  sendInput(0, 0, 0, 0, false);
  await new Promise((r) => setTimeout(r, 300));
  console.log("pos after nav:", getSelf().position, " armor:", getSelf().armor, " health:", getSelf().health);

  // Wait a bit more near the pickup in case we need a final approach nudge
  if (getSelf().armor === 0) {
    console.log("armor still 0, nudging closer...");
    const nav2 = setInterval(() => {
      const self = getSelf();
      const yaw = yawTowards(target.x - self.position.x, target.z - self.position.z);
      sendInput(1, 0, yaw, 0, false);
    }, 33);
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(nav2);
    sendInput(0, 0, 0, 0, false);
    await new Promise((r) => setTimeout(r, 300));
    console.log("pos after nudge:", getSelf().position, " armor:", getSelf().armor, " health:", getSelf().health);
  }

  const armorAfterPickup = getSelf().armor;
  const healthAfterPickup = getSelf().health;
  console.log(`ARMOR AFTER PICKUP ATTEMPT: armor=${armorAfterPickup}, health=${healthAfterPickup}`);

  // Now stand still and let a bot hit us, observing whether armor absorbs
  // damage before health (EPIC 7 spillover rule) by watching consecutive
  // HitEvents targeting us.
  console.log("standing still, waiting to be hit (up to 6s)...");
  const before = { armor: getSelf().armor, health: getSelf().health };
  await new Promise((r) => setTimeout(r, 6000));
  const after = { armor: getSelf().armor, health: getSelf().health };
  console.log("before-hits state:", before, "after-wait state:", after);
  console.log(
    "HitEvents targeting us during wait:",
    hits.map((h) => ({ dmg: h.damage, targetHealth: h.targetHealth })),
  );

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
