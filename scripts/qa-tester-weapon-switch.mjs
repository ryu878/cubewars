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
  const loadouts = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") playerId = msg.playerId;
    if (msg.type === "world_state") lastState = msg;
    if (msg.type === "loadout") loadouts.push(msg);
  });
  await waitFor(ws, (m) => m.type === "welcome");
  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");

  const sendInput = (moveForward, moveRight, yaw, pitch, jump) =>
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  const getSelf = () => lastState.players.find((p) => p.id === playerId);

  console.log("spawn:", getSelf().position);
  console.log("initial loadout:", loadouts[loadouts.length - 1]);

  const target = { x: 0, z: 0 }; // weapon_gl_mid
  const nav = setInterval(() => {
    const self = getSelf();
    const yaw = yawTowards(target.x - self.position.x, target.z - self.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, 6000));
  clearInterval(nav);
  sendInput(0, 0, 0, 0, false);
  await new Promise((r) => setTimeout(r, 400));
  console.log("pos after nav:", getSelf().position);
  console.log("loadout after nav (should show grenade_launcher auto-equipped, higher tier than pistol):", loadouts[loadouts.length - 1]);

  // Cycle weapon with E (switch_weapon)
  ws.send(JSON.stringify({ type: "switch_weapon" }));
  await new Promise((r) => setTimeout(r, 200));
  console.log("loadout after 1x switch_weapon:", loadouts[loadouts.length - 1]);
  ws.send(JSON.stringify({ type: "switch_weapon" }));
  await new Promise((r) => setTimeout(r, 200));
  console.log("loadout after 2x switch_weapon:", loadouts[loadouts.length - 1]);

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
