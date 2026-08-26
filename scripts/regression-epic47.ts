// EPIC 47 regression: ~4× pickup density + clearance, bots mapId → non-Base
// map_state, leave_match returns socket to lobby (no ghost / can rejoin).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  EPIC47_PICKUP_COUNTS,
  PLAYER_COLLISION_RADIUS,
  BASE_BUILDING_INTERIOR_SAMPLE,
  boxBounds,
  getMap,
  listMaps,
  type MapBox,
  type ServerMessage,
} from "@cubewars/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SERVER_PORT = 7817;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const SPAWN_CLEARANCE_RADIUS = PLAYER_COLLISION_RADIUS;
const PICKUP_CLEARANCE_RADIUS = 0.6;

interface Client {
  ws: WebSocket;
  playerId: string;
  messages: ServerMessage[];
}

function circleHitsBox(cx: number, cz: number, radius: number, box: MapBox): boolean {
  const b = boxBounds(box);
  const nearestX = Math.max(b.minX, Math.min(cx, b.maxX));
  const nearestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - nearestX;
  const dz = cz - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

function assertPointClear(
  mapId: string,
  label: string,
  x: number,
  z: number,
  radius: number,
  geometry: readonly MapBox[],
  kinds: ReadonlySet<MapBox["kind"]>,
): void {
  for (const box of geometry) {
    if (!kinds.has(box.kind)) continue;
    assert.ok(
      !circleHitsBox(x, z, radius, box),
      `${mapId}: ${label} (${x},${z}) overlaps ${box.kind} ${box.id}`,
    );
  }
}

function assertCatalogDensityAndClearance(): void {
  const blocking = new Set<MapBox["kind"]>(["wall", "prop", "crate"]);
  for (const map of listMaps()) {
    const byCat = { weapon: 0, ammo: 0, health: 0, armor: 0 };
    for (const pickup of map.pickupPoints) {
      byCat[pickup.category] += 1;
      assertPointClear(
        map.id,
        `pickup ${pickup.id}`,
        pickup.position.x,
        pickup.position.z,
        PICKUP_CLEARANCE_RADIUS,
        map.geometry,
        blocking,
      );
    }
    assert.equal(byCat.weapon, EPIC47_PICKUP_COUNTS.weapon, `${map.id} weapon count`);
    assert.equal(byCat.ammo, EPIC47_PICKUP_COUNTS.ammo, `${map.id} ammo count`);
    assert.equal(byCat.health, EPIC47_PICKUP_COUNTS.health, `${map.id} health count`);
    assert.equal(byCat.armor, EPIC47_PICKUP_COUNTS.armor, `${map.id} armor count`);
    assert.equal(map.pickupPoints.length, EPIC47_PICKUP_COUNTS.total, `${map.id} total pickups`);

    for (const point of map.spawnPoints) {
      assertPointClear(
        map.id,
        "spawn",
        point.x,
        point.z,
        SPAWN_CLEARANCE_RADIUS,
        map.geometry,
        blocking,
      );
    }
  }

  const base = getMap("base");
  assertPointClear(
    "base",
    "building interior sample",
    BASE_BUILDING_INTERIOR_SAMPLE.x,
    BASE_BUILDING_INTERIOR_SAMPLE.z,
    SPAWN_CLEARANCE_RADIUS,
    base.geometry,
    new Set(["wall", "prop"]),
  );
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
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolve();
    }, 3000);
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

async function main(): Promise<void> {
  assertCatalogDensityAndClearance();
  console.log("[epic47] catalog density + clearance OK");

  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitReady(child, "listening on");

  const clients: Client[] = [];
  try {
    // Bots + non-Base mapId
    const bots = await connect();
    clients.push(bots);
    const before = bots.messages.length;
    bots.ws.send(
      JSON.stringify({
        type: "join",
        mode: "bots",
        nickname: "Epic47Bots",
        mapId: "rust_canyon",
      }),
    );
    const accepted = await waitFor(
      bots,
      before,
      (m) => m.type === "join_accepted" || m.type === "join_rejected",
    );
    assert.equal(accepted.type, "join_accepted");
    if (accepted.type === "join_accepted") {
      assert.equal(accepted.mapId, "rust_canyon");
      assert.equal(accepted.mode, "bots");
    }
    const mapState = await waitFor(bots, before, (m) => m.type === "map_state");
    assert.equal(mapState.type, "map_state");
    if (mapState.type === "map_state") {
      assert.equal(mapState.mapId, "rust_canyon");
      const ids = mapState.geometry.map((b) => b.id);
      assert.ok(ids.some((id) => id.startsWith("rc_")), "bots map_state must be rust_canyon geometry");
      assert.ok(!ids.some((id) => id.startsWith("base_")), "bots map_state must not be Base geometry");
      assert.equal(mapState.geometry.length, getMap("rust_canyon").geometry.length);
    }

    // leave_match → lobby, then rejoin public on glass_dome
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
        nickname: "Epic47Bots",
        mapId: "glass_dome",
      }),
    );
    const rejoin = await waitFor(
      bots,
      rejoinBefore,
      (m) => m.type === "join_accepted" || m.type === "join_rejected",
    );
    assert.equal(rejoin.type, "join_accepted");
    if (rejoin.type === "join_accepted") {
      assert.equal(rejoin.mapId, "glass_dome");
      assert.equal(rejoin.mode, "public");
    }
    const domeState = await waitFor(bots, rejoinBefore, (m) => m.type === "map_state");
    assert.equal(domeState.type, "map_state");
    if (domeState.type === "map_state") {
      assert.equal(domeState.mapId, "glass_dome");
      assert.ok(domeState.geometry.some((b) => b.id.startsWith("gd_")));
    }

    // Second human must not see ghost from prior bots match (bots torn down).
    const other = await connect();
    clients.push(other);
    const lobby = await waitFor(other, 0, (m) => m.type === "lobby_state");
    assert.equal(lobby.type, "lobby_state");
    if (lobby.type === "lobby_state") {
      for (const match of lobby.matches) {
        assert.ok(!match.id.startsWith("bots:"), "empty bots match must be torn down");
      }
    }

    console.log("[epic47] PASS");
  } finally {
    for (const client of clients) client.ws.close();
    await stopServer(child);
  }
}

main().catch((err) => {
  console.error("[epic47] FAIL", err);
  process.exit(1);
});
