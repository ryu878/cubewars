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

// forwardX = -sin(yaw), forwardZ = -cos(yaw) (matches server/src/playerRegistry.ts).
// Given a desired unit direction (dx, dz), solve for yaw.
function yawTowards(dx, dz) {
  return Math.atan2(-dx, -dz);
}

async function runScenario(name, { computeYaw, warmupMs, testMs, jumpBoost, cornerTarget }) {
  const ws = await connect();
  let playerId = null;
  let lastState = null;

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") playerId = msg.playerId;
    if (msg.type === "world_state") lastState = msg;
  });

  await waitFor(ws, (m) => m.type === "welcome");
  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");

  const sendInput = (moveForward, moveRight, yaw, pitch, jump) => {
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  };
  const getSelf = () => lastState.players.find((p) => p.id === playerId);

  await new Promise((r) => setTimeout(r, 200));
  console.log(`\n=== ${name} ===`);
  const spawnPos = getSelf().position;
  console.log("spawn pos:", spawnPos);

  let yaw = computeYaw(spawnPos);
  if (cornerTarget) {
    console.log(`targeting corner (${cornerTarget.x}, ${cornerTarget.z}), initial yaw=${yaw.toFixed(3)}`);
  }

  // Warmup: recompute yaw toward the target corner every send so the path
  // curves toward it even if the first straight-line guess grazes an
  // interior divider (keeps the test robust across all 6 spawn points).
  const warmTimer = setInterval(() => {
    const self = getSelf();
    if (cornerTarget) yaw = yawTowards(cornerTarget.x - self.position.x, cornerTarget.z - self.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, warmupMs));
  clearInterval(warmTimer);
  sendInput(0, 0, yaw, 0, false);
  await new Promise((r) => setTimeout(r, 200));
  console.log("post-warmup pos:", getSelf().position);

  if (cornerTarget) {
    const self = getSelf();
    yaw = yawTowards(cornerTarget.x - self.position.x, cornerTarget.z - self.position.z);
  }

  if (jumpBoost) {
    sendInput(0, 0, yaw, 0, true);
    await new Promise((r) => setTimeout(r, 60));
    sendInput(0, 0, yaw, 0, false);
    await new Promise((r) => setTimeout(r, 60));
    sendInput(1, 0, yaw, 0, true); // edge while airborne -> boost
    await new Promise((r) => setTimeout(r, 20));
  }

  const positions = [];
  const sampleTimer = setInterval(() => {
    if (lastState) positions.push({ t: lastState.serverTimeMs, pos: { ...getSelf().position } });
  }, 50);
  const testTimer = setInterval(() => {
    const self = getSelf();
    if (cornerTarget) yaw = yawTowards(cornerTarget.x - self.position.x, cornerTarget.z - self.position.z);
    sendInput(1, 0, yaw, 0, false);
  }, 33);
  await new Promise((r) => setTimeout(r, testMs));
  clearInterval(sampleTimer);
  clearInterval(testTimer);

  const finalPos = getSelf().position;
  console.log("final pos:", finalPos);
  console.log(`sampled ${positions.length} positions over the run`);
  const maxAbsX = Math.max(...positions.map((p) => Math.abs(p.pos.x)));
  const maxAbsZ = Math.max(...positions.map((p) => Math.abs(p.pos.z)));
  console.log(`max |x| reached = ${maxAbsX.toFixed(3)}, max |z| reached = ${maxAbsZ.toFixed(3)}`);

  ws.close();
  return { finalPos, positions, maxAbsX, maxAbsZ };
}

async function main() {
  // outer_north wall: center z=26, half-thickness 0.5 -> near face z=25.5, far face z=26.5.
  // Player radius 0.4 -> should stop at z ~= 25.1, must NEVER exceed 26.5 (tunneled through).
  await runScenario("Straight-on wall approach @ BASE speed (13.3 m/s), heading toward outer_north wall", {
    computeYaw: () => Math.PI, // forwardZ = -cos(PI) = +1 -> heads +z
    warmupMs: 800,
    testMs: 3000,
    jumpBoost: false,
  });

  await new Promise((r) => setTimeout(r, 500));
  await runScenario("Straight-on wall approach @ BOOSTED bunny-hop speed (~17.3 m/s), heading toward outer_north wall", {
    computeYaw: () => Math.PI,
    warmupMs: 600,
    testMs: 3000,
    jumpBoost: true,
  });

  // Corner approach: whichever outer corner is nearest this connection's spawn
  // point (outer walls at x=+-46, z=+-26; NE corner e.g. (46,26)). Yaw is
  // recomputed toward that fixed target every send, so the path curves
  // correctly regardless of which of the 6 spawn points we land on relative
  // to interior dividers. Must NEVER cross to the far side of either wall
  // (|x| > 46.5 or |z| > 26.5) — the corner-pop overshoot case from EPIC 8.
  await new Promise((r) => setTimeout(r, 500));
  await runScenario("Diagonal CORNER approach @ BASE speed (13.3 m/s)", {
    computeYaw: (spawn) => yawTowards(Math.sign(spawn.x) * 46 - spawn.x, Math.sign(spawn.z || 1) * 26 - spawn.z),
    cornerTarget: null, // set below per-spawn dynamically via computeYaw's sign logic + live re-aim
    warmupMs: 2500,
    testMs: 2500,
    jumpBoost: false,
  });
}

// Re-run main with proper dynamic corner target resolution (needs spawn pos
// known before choosing the fixed (x,z) corner target) — done as a second
// pass below instead of inside main() for clarity.
async function runCornerScenario(label, jumpBoost) {
  const ws = await connect();
  let playerId = null;
  let lastState = null;
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") playerId = msg.playerId;
    if (msg.type === "world_state") lastState = msg;
  });
  await waitFor(ws, (m) => m.type === "welcome");
  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");
  const sendInput = (moveForward, moveRight, yaw, pitch, jump) => {
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  };
  const getSelf = () => lastState.players.find((p) => p.id === playerId);
  await new Promise((r) => setTimeout(r, 200));
  console.log(`\n=== ${label} ===`);
  const spawn = getSelf().position;
  console.log("spawn pos:", spawn);
  const target = { x: Math.sign(spawn.x || 1) * 46, z: Math.sign(spawn.z || 1) * 26 };
  console.log("corner target:", target);

  const drive = (ms) =>
    new Promise((resolve) => {
      const t = setInterval(() => {
        const self = getSelf();
        const yaw = yawTowards(target.x - self.position.x, target.z - self.position.z);
        sendInput(1, 0, yaw, 0, false);
      }, 33);
      setTimeout(() => {
        clearInterval(t);
        resolve();
      }, ms);
    });

  await drive(3000);
  sendInput(0, 0, 0, 0, false);
  await new Promise((r) => setTimeout(r, 200));
  console.log("post-warmup pos:", getSelf().position);

  if (jumpBoost) {
    const self = getSelf();
    const yaw = yawTowards(target.x - self.position.x, target.z - self.position.z);
    sendInput(0, 0, yaw, 0, true);
    await new Promise((r) => setTimeout(r, 60));
    sendInput(0, 0, yaw, 0, false);
    await new Promise((r) => setTimeout(r, 60));
    sendInput(1, 0, yaw, 0, true);
    await new Promise((r) => setTimeout(r, 20));
  }

  const positions = [];
  const sampleTimer = setInterval(() => {
    if (lastState) positions.push({ t: lastState.serverTimeMs, pos: { ...getSelf().position } });
  }, 50);
  await drive(2500);
  clearInterval(sampleTimer);

  const finalPos = getSelf().position;
  console.log("final pos:", finalPos);
  const maxAbsX = Math.max(...positions.map((p) => Math.abs(p.pos.x)));
  const maxAbsZ = Math.max(...positions.map((p) => Math.abs(p.pos.z)));
  console.log(`max |x| reached = ${maxAbsX.toFixed(3)}, max |z| reached = ${maxAbsZ.toFixed(3)}`);
  console.log(`corner target was (${target.x}, ${target.z}); far-side limits would be |x|>46.5 or |z|>26.5`);

  ws.close();
}

async function realMain() {
  await runScenario("Straight-on wall approach @ BASE speed (13.3 m/s), heading toward outer_north wall", {
    computeYaw: () => Math.PI,
    warmupMs: 800,
    testMs: 3000,
    jumpBoost: false,
  });

  await new Promise((r) => setTimeout(r, 500));
  await runScenario("Straight-on wall approach @ BOOSTED bunny-hop speed (~17.3 m/s), heading toward outer_north wall", {
    computeYaw: () => Math.PI,
    warmupMs: 600,
    testMs: 3000,
    jumpBoost: true,
  });

  await new Promise((r) => setTimeout(r, 500));
  await runCornerScenario("Diagonal CORNER approach @ BASE speed (13.3 m/s)", false);

  await new Promise((r) => setTimeout(r, 500));
  await runCornerScenario("Diagonal CORNER approach @ BOOSTED speed (~17.3 m/s)", true);

  process.exit(0);
}

realMain().catch((e) => {
  console.error(e);
  process.exit(1);
});
