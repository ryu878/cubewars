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

async function main() {
  const ws = await connect();
  let playerId = null;
  let lastState = null;
  const states = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "welcome") {
      playerId = msg.playerId;
    }
    if (msg.type === "world_state") {
      lastState = msg;
      states.push(msg);
    }
  });

  await waitFor(ws, (m) => m.type === "welcome");
  console.log("connected, playerId=", playerId);

  ws.send(JSON.stringify({ type: "join", mode: "bots" }));
  await waitFor(ws, (m) => m.type === "world_state");
  console.log("joined bots mode");

  // send neutral input a couple times to settle
  const sendInput = (moveForward, moveRight, yaw, pitch, jump) => {
    ws.send(JSON.stringify({ type: "input", moveForward, moveRight, yaw, pitch, jump }));
  };

  // Face a fixed yaw (0 rad) and hold forward for a straight-line run
  const YAW = Math.PI; // forwardZ = -cos(PI) = +1 -> heads toward +z (away from outer_south wall)
  sendInput(0, 0, YAW, 0, false);
  await new Promise((r) => setTimeout(r, 200));

  function getSelf() {
    return lastState.players.find((p) => p.id === playerId);
  }

  // wait for a stable state
  await new Promise((r) => setTimeout(r, 300));
  const p0 = getSelf();
  console.log("start pos:", p0.position);

  // Hold forward, sending input at ~30Hz. Warm up first so movement is
  // already fully saturated, then record EVERY world_state sample (server
  // timestamp + position) for a window, and post-process: compute per-tick
  // instantaneous speed between consecutive samples, discard any tick where
  // displacement collapses (a wall/geometry stop mid-window), and report the
  // median of the remaining (clean, unobstructed) per-tick speeds -- this
  // avoids the whole-window-average being wrecked by running into a wall
  // partway through, and avoids Date.now() client-side jitter (server
  // timestamps only).
  const sendIntervalMs = 33;
  const inputTimer = setInterval(() => {
    sendInput(1, 0, YAW, 0, false);
  }, sendIntervalMs);

  await new Promise((r) => setTimeout(r, 500)); // warmup

  const samples = [];
  const sampleHandler = () => {
    if (lastState) samples.push({ t: lastState.serverTimeMs, pos: { ...getSelf().position } });
  };
  const sampleTimer = setInterval(sampleHandler, 50);

  await new Promise((r) => setTimeout(r, 2000));
  clearInterval(sampleTimer);
  clearInterval(inputTimer);

  const perTick = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    perTick.push({ speed: dist / dt, dist, dt });
  }
  perTick.sort((a, b) => a.speed - b.speed);
  const median = perTick[Math.floor(perTick.length / 2)]?.speed ?? NaN;
  const max = perTick[perTick.length - 1]?.speed ?? NaN;
  console.log(`BASE SPEED: ${perTick.length} per-tick samples, median=${median.toFixed(4)} m/s, max=${max.toFixed(4)} m/s`);
  console.log("posStart", samples[0]?.pos, "posEnd", samples[samples.length - 1]?.pos);

  // Stop moving, then turn AROUND (we're now near the wall we were running
  // toward) so the boost test has clearance in front of it instead of
  // running straight into the wall we just stopped at.
  const BOOST_YAW = 0; // forwardZ = -cos(0) = -1 -> heads back the other way
  sendInput(0, 0, BOOST_YAW, 0, false);
  await new Promise((r) => setTimeout(r, 300));

  // Now test bunny hop boosted speed: jump, then while airborne, jump again (edge)
  // First jump from ground
  sendInput(0, 0, BOOST_YAW, 0, true);
  await new Promise((r) => setTimeout(r, 60));
  sendInput(0, 0, BOOST_YAW, 0, false);
  await new Promise((r) => setTimeout(r, 60));
  // second jump edge while airborne -> triggers bunny hop boost
  sendInput(1, 0, BOOST_YAW, 0, true);
  await new Promise((r) => setTimeout(r, 40));

  // Now measure speed while airSpeedMultiplier active (boosted), holding forward
  const boostTimer = setInterval(() => {
    sendInput(1, 0, BOOST_YAW, 0, false);
  }, sendIntervalMs);

  const boostStartState = lastState;
  const bposStart = { ...getSelf().position };
  const bt0 = boostStartState.serverTimeMs;
  await new Promise((r) => setTimeout(r, 400)); // short window while airborne+boosted
  const boostEndState = lastState;
  const bposEnd = { ...getSelf().position };
  const bt1 = boostEndState.serverTimeMs;
  clearInterval(boostTimer);
  console.log("boost window y:", bposStart.y, "->", bposEnd.y, "(airborne throughout if both > groundY 0)");

  const bdx = bposEnd.x - bposStart.x;
  const bdz = bposEnd.z - bposStart.z;
  const bdist = Math.hypot(bdx, bdz);
  const bdt = (bt1 - bt0) / 1000;
  console.log(`BOOSTED SPEED (short window while airborne): moved ${bdist.toFixed(4)}m in ${bdt.toFixed(3)}s => ${(bdist / bdt).toFixed(4)} m/s`);
  console.log("bposStart", bposStart, "bposEnd", bposEnd);

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
