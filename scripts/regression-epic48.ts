// EPIC 48 regression: balanced/spread pickups; public + bots non-Base mapId
 // must not yield Base geometry/bounds; leave→rejoin preserves selected map.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  EPIC48_PICKUP_COUNTS,
  getMap,
  listMaps,
  type MapBox,
  type MapId,
  type ServerMessage,
} from "@cubewars/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SERVER_PORT = 7818;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

interface Client {
  ws: WebSocket;
  playerId: string;
  messages: ServerMessage[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitReady(child: ReturnType<typeof spawn>, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      process.stdout.write(text);
      if (!ready && text.includes(marker)) {
        ready = true;
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited before ready (code ${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server ready timeout"));
    }, 45000);
  });
}

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!child || child.killed) return resolve();
    const done = () => resolve();
    child.once("exit", done);
    // Kill the whole process group — npx/tsx leaves orphans on plain SIGTERM.
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
      resolve();
    }, 2000);
  });
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const client: Client = { ws, playerId: "", messages: [] };
    const timer = setTimeout(() => reject(new Error("connect timeout")), 10000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      client.messages.push(msg);
      if (msg.type === "welcome") {
        client.playerId = msg.playerId;
        clearTimeout(timer);
        resolve(client);
      }
    });
    ws.on("error", reject);
  });
}

function waitFor(
  client: Client,
  afterIndex: number,
  pred: (m: ServerMessage) => boolean,
  timeoutMs = 8000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      for (let i = afterIndex; i < client.messages.length; i++) {
        const m = client.messages[i]!;
        if (pred(m)) {
          resolve(m);
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor timeout"));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function assertNotBaseGeometry(
  label: string,
  mapId: MapId,
  geometry: readonly MapBox[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  const expected = getMap(mapId);
  const base = getMap("base");
  const ids = geometry.map((b) => b.id);
  assert.ok(!ids.some((id) => id.startsWith("base_")), `${label}: must not be Base geometry`);
  assert.equal(geometry.length, expected.geometry.length, `${label}: geometry length`);
  assert.equal(bounds.minX, expected.bounds.minX, `${label}: bounds.minX`);
  assert.equal(bounds.maxX, expected.bounds.maxX, `${label}: bounds.maxX`);
  assert.equal(bounds.minZ, expected.bounds.minZ, `${label}: bounds.minZ`);
  assert.equal(bounds.maxZ, expected.bounds.maxZ, `${label}: bounds.maxZ`);
  assert.notEqual(geometry.length, 0);
  assert.ok(
    JSON.stringify(geometry.map((b) => b.id).sort()) !==
      JSON.stringify(base.geometry.map((b) => b.id).sort()),
    `${label}: geometry id set must differ from Base`,
  );
}

/**
 * Heuristic: consecutive same-category pickups must not form a long collinear runway.
 * Fails the old EPIC 47 sequential lattice pattern (many weapons on one row).
 */
function assertNoWeaponRunway(mapId: MapId): void {
  const map = getMap(mapId);
  const weapons = map.pickupPoints.filter((p) => p.category === "weapon");
  assert.equal(weapons.length, EPIC48_PICKUP_COUNTS.weapon, `${mapId} weapon count`);

  // Group by nearly-equal Z (row) — no row should hold >3 weapons.
  const rows = new Map<number, number>();
  for (const w of weapons) {
    const zKey = Math.round(w.position.z);
    rows.set(zKey, (rows.get(zKey) ?? 0) + 1);
  }
  for (const [z, count] of rows) {
    assert.ok(
      count <= 3,
      `${mapId}: weapon runway at z≈${z} has ${count} weapons (spread placement failed)`,
    );
  }

  // Pairwise: at least some weapons should be far apart (not a tight cluster).
  let maxPair = 0;
  for (let i = 0; i < weapons.length; i++) {
    for (let j = i + 1; j < weapons.length; j++) {
      const dx = weapons[i]!.position.x - weapons[j]!.position.x;
      const dz = weapons[i]!.position.z - weapons[j]!.position.z;
      maxPair = Math.max(maxPair, Math.hypot(dx, dz));
    }
  }
  assert.ok(maxPair > 40, `${mapId}: weapons not spread enough (max pairwise ${maxPair})`);
}

function assertCatalogCountsAndSpread(): void {
  for (const map of listMaps()) {
    const byCat = { weapon: 0, ammo: 0, health: 0, armor: 0 };
    for (const pickup of map.pickupPoints) {
      byCat[pickup.category] += 1;
    }
    assert.equal(byCat.weapon, EPIC48_PICKUP_COUNTS.weapon, `${map.id} weapon`);
    assert.equal(byCat.ammo, EPIC48_PICKUP_COUNTS.ammo, `${map.id} ammo`);
    assert.equal(byCat.health, EPIC48_PICKUP_COUNTS.health, `${map.id} health`);
    assert.equal(byCat.armor, EPIC48_PICKUP_COUNTS.armor, `${map.id} armor`);
    assert.equal(map.pickupPoints.length, EPIC48_PICKUP_COUNTS.total, `${map.id} total`);
    assertNoWeaponRunway(map.id);
  }
}

async function main(): Promise<void> {
  assertCatalogCountsAndSpread();
  console.log("[epic48] catalog counts + spread OK");

  const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  await waitReady(child, "listening on");

  const clients: Client[] = [];
  try {
    // Fresh server: lobby must not advertise an empty Base trap match.
    const lobbyProbe = await connect();
    clients.push(lobbyProbe);
    const lobby0 = await waitFor(lobbyProbe, 0, (m) => m.type === "lobby_state");
    assert.equal(lobby0.type, "lobby_state");
    if (lobby0.type === "lobby_state") {
      assert.equal(
        lobby0.matches.length,
        0,
        "EPIC 48: no pre-created empty Base public match at startup",
      );
    }

    // Public Quick Join with non-Base mapId → that map's geometry (not Base).
    const pub = await connect();
    clients.push(pub);
    const pubBefore = pub.messages.length;
    pub.ws.send(
      JSON.stringify({
        type: "join",
        mode: "public",
        nickname: "Epic48Pub",
        mapId: "rust_canyon",
      }),
    );
    const pubAccepted = await waitFor(
      pub,
      pubBefore,
      (m) => m.type === "join_accepted" || m.type === "join_rejected",
    );
    assert.equal(pubAccepted.type, "join_accepted");
    if (pubAccepted.type === "join_accepted") {
      assert.equal(pubAccepted.mapId, "rust_canyon");
      assert.equal(pubAccepted.mode, "public");
    }
    const pubMap = await waitFor(pub, pubBefore, (m) => m.type === "map_state");
    assert.equal(pubMap.type, "map_state");
    if (pubMap.type === "map_state") {
      assert.equal(pubMap.mapId, "rust_canyon");
      assert.ok(pubMap.geometry.some((b) => b.id.startsWith("rc_")));
      assertNotBaseGeometry("public rust_canyon", "rust_canyon", pubMap.geometry, pubMap.bounds);
    }

    // Bots with non-Base mapId
    const bots = await connect();
    clients.push(bots);
    const botsBefore = bots.messages.length;
    bots.ws.send(
      JSON.stringify({
        type: "join",
        mode: "bots",
        nickname: "Epic48Bots",
        mapId: "glass_dome",
      }),
    );
    const botsAccepted = await waitFor(
      bots,
      botsBefore,
      (m) => m.type === "join_accepted" || m.type === "join_rejected",
    );
    assert.equal(botsAccepted.type, "join_accepted");
    if (botsAccepted.type === "join_accepted") {
      assert.equal(botsAccepted.mapId, "glass_dome");
    }
    const botsMap = await waitFor(bots, botsBefore, (m) => m.type === "map_state");
    assert.equal(botsMap.type, "map_state");
    if (botsMap.type === "map_state") {
      assert.equal(botsMap.mapId, "glass_dome");
      assert.ok(botsMap.geometry.some((b) => b.id.startsWith("gd_")));
      assert.ok(!botsMap.geometry.some((b) => b.id.startsWith("base_")));
      assert.equal(botsMap.geometry.length, getMap("glass_dome").geometry.length);
    }

    // ESC-equivalent: leave_match → rejoin public with another non-Base map
    const leaveBefore = bots.messages.length;
    bots.ws.send(JSON.stringify({ type: "leave_match" }));
    const leaveAck = await waitFor(bots, leaveBefore, (m) => m.type === "leave_match_ack");
    assert.equal(leaveAck.type, "leave_match_ack");

    await sleep(100);
    const rejoinBefore = bots.messages.length;
    bots.ws.send(
      JSON.stringify({
        type: "join",
        mode: "public",
        nickname: "Epic48Bots",
        mapId: "fuel_depot",
      }),
    );
    const rejoin = await waitFor(
      bots,
      rejoinBefore,
      (m) => m.type === "join_accepted" || m.type === "join_rejected",
    );
    assert.equal(rejoin.type, "join_accepted");
    if (rejoin.type === "join_accepted") {
      assert.equal(rejoin.mapId, "fuel_depot");
    }
    const rejoinMap = await waitFor(bots, rejoinBefore, (m) => m.type === "map_state");
    assert.equal(rejoinMap.type, "map_state");
    if (rejoinMap.type === "map_state") {
      assert.equal(rejoinMap.mapId, "fuel_depot");
      assert.ok(rejoinMap.geometry.some((b) => b.id.startsWith("fd_")));
      assert.ok(!rejoinMap.geometry.some((b) => b.id.startsWith("base_")));
    }

    // Empty public matches tear down — after pub leaves, rust_canyon row gone if alone.
    const pubLeaveBefore = pub.messages.length;
    pub.ws.send(JSON.stringify({ type: "leave_match" }));
    await waitFor(pub, pubLeaveBefore, (m) => m.type === "leave_match_ack");
    await sleep(150);
    const lobbyAfter = await connect();
    clients.push(lobbyAfter);
    const lobby1 = await waitFor(lobbyAfter, 0, (m) => m.type === "lobby_state");
    assert.equal(lobby1.type, "lobby_state");
    if (lobby1.type === "lobby_state") {
      // bots rejoined public fuel_depot — may still be in lobby; no empty Base-only trap.
      assert.ok(
        !lobby1.matches.some((m) => m.mapId === "base" && m.players === 0),
        "no empty Base public match in lobby",
      );
      const fuel = lobby1.matches.find((m) => m.mapId === "fuel_depot");
      assert.ok(fuel, "fuel_depot match should still be listed while occupied");
    }

    console.log("[epic48] PASS");
  } finally {
    for (const client of clients) {
      try {
        client.ws.close();
      } catch {
        /* ignore */
      }
    }
    await stopServer(child);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[epic48] FAIL", err);
  process.exit(1);
});
