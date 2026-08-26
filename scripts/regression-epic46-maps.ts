// EPIC 46 regression: public capacity 8, map catalog join/create,
// join-existing ignores client mapId, invalid map rejected, lobby shows map.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  MAX_PUBLIC_PLAYERS_PER_MATCH,
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
const SERVER_PORT = 7786;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

/** Horizontal clearance for spawn footprints (matches player collision). */
const SPAWN_CLEARANCE_RADIUS = PLAYER_COLLISION_RADIUS;
/** Slightly larger than spawn so pickups stay reachable beside props/crates. */
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

function assertCatalogClearance(): void {
  const blockingForSpawn = new Set<MapBox["kind"]>(["wall", "prop", "crate"]);
  const blockingForPickup = new Set<MapBox["kind"]>(["wall", "prop", "crate"]);

  for (const map of listMaps()) {
    for (const point of map.spawnPoints) {
      assertPointClear(
        map.id,
        "spawn",
        point.x,
        point.z,
        SPAWN_CLEARANCE_RADIUS,
        map.geometry,
        blockingForSpawn,
      );
    }
    for (const pickup of map.pickupPoints) {
      assertPointClear(
        map.id,
        `pickup ${pickup.id}`,
        pickup.position.x,
        pickup.position.z,
        PICKUP_CLEARANCE_RADIUS,
        map.geometry,
        blockingForPickup,
      );
    }
  }

  // F-002: known free point inside Base building footprint is walkable.
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
  const { minX, maxX, minZ, maxZ } = {
    minX: -40,
    maxX: -28,
    minZ: -15,
    maxZ: -6,
  };
  assert.ok(
    BASE_BUILDING_INTERIOR_SAMPLE.x > minX &&
      BASE_BUILDING_INTERIOR_SAMPLE.x < maxX &&
      BASE_BUILDING_INTERIOR_SAMPLE.z > minZ &&
      BASE_BUILDING_INTERIOR_SAMPLE.z < maxZ,
    "BASE_BUILDING_INTERIOR_SAMPLE must lie inside the building footprint",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(): Promise<{ child: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf: Buffer) => {
      if (!ready && buf.toString().includes("cubewars game server listening")) {
        ready = true;
        resolve({ child });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited before ready (${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server did not become ready"));
    }, 8000);
  });
}

function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGINT");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, 3000);
  });
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages: ServerMessage[] = [];
    let playerId = "";
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      messages.push(message);
      if (message.type === "welcome") playerId = message.playerId;
    });
    ws.on("open", () => {
      const timer = setInterval(() => {
        if (playerId) {
          clearInterval(timer);
          resolve({ ws, playerId, messages });
        }
      }, 20);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error("missing welcome"));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

async function waitFor(
  client: Client,
  before: number,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  for (let i = 0; i < 120; i++) {
    const message = client.messages.slice(before).find(predicate);
    if (message) return message;
    await sleep(30);
  }
  throw new Error("timed out waiting for message");
}

async function joinPublic(
  client: Client,
  nickname: string,
  opts: { matchId?: string; mapId?: string } = {},
): Promise<ServerMessage> {
  const before = client.messages.length;
  client.ws.send(
    JSON.stringify({
      type: "join",
      mode: "public",
      nickname,
      matchId: opts.matchId,
      mapId: opts.mapId,
    }),
  );
  return waitFor(
    client,
    before,
    (item) => item.type === "join_accepted" || item.type === "join_rejected",
  );
}

async function main(): Promise<void> {
  assert.equal(MAX_PUBLIC_PLAYERS_PER_MATCH, 8);
  assert.equal(listMaps().length, 8);
  for (const map of listMaps()) {
    assert.ok(map.spawnPoints.length >= 8, `${map.id} needs ≥8 spawns`);
    assert.ok(map.pickupPoints.length >= 10, `${map.id} needs denser pickups`);
    assert.equal(map.bounds.maxX - map.bounds.minX, 92);
    assert.equal(map.bounds.maxZ - map.bounds.minZ, 52);
  }
  const base = getMap("base");
  assert.ok(base.geometry.some((box) => box.id.startsWith("base_bld_")));
  assert.ok(base.geometry.some((box) => box.id.startsWith("base_car_")));
  assert.ok(base.geometry.some((box) => box.kind === "prop"));
  assertCatalogClearance();

  const { child } = await startServer();
  const clients: Client[] = [];
  try {
    // Fill default Base public match to capacity 8.
    for (let i = 1; i <= 8; i++) {
      const client = await connect();
      clients.push(client);
      const accepted = await joinPublic(client, `Cap ${i}`, { mapId: "base" });
      assert.equal(accepted.type, "join_accepted");
      if (accepted.type === "join_accepted") {
        assert.equal(accepted.matchId, "public");
      }
    }

    const overflow = await connect();
    clients.push(overflow);
    const overflowJoin = await joinPublic(overflow, "Cap 9", { mapId: "base" });
    assert.equal(overflowJoin.type, "join_accepted");
    if (overflowJoin.type === "join_accepted") {
      assert.equal(overflowJoin.matchId, "public-2");
    }

    // Create / join a themed map match.
    const themed = await connect();
    clients.push(themed);
    const themedJoin = await joinPublic(themed, "Canyon 1", { mapId: "rust_canyon" });
    assert.equal(themedJoin.type, "join_accepted");
    if (themedJoin.type !== "join_accepted") throw new Error("unreachable");
    const themedMatchId = themedJoin.matchId;

    const mapState = await waitFor(themed, 0, (m) => m.type === "map_state");
    assert.equal(mapState.type, "map_state");
    if (mapState.type === "map_state") {
      const expected = getMap("rust_canyon");
      assert.equal(mapState.mapId, "rust_canyon");
      assert.equal(mapState.bounds.minX, expected.bounds.minX);
      assert.equal(mapState.geometry.length, expected.geometry.length);
    }

    // Join existing: client mapId ignored (server owns map).
    const joiner = await connect();
    clients.push(joiner);
    const joinExisting = await joinPublic(joiner, "Canyon 2", {
      matchId: themedMatchId,
      mapId: "glass_dome",
    });
    assert.equal(joinExisting.type, "join_accepted");
    if (joinExisting.type === "join_accepted") {
      assert.equal(joinExisting.matchId, themedMatchId);
    }
    const joinerMap = await waitFor(joiner, 0, (m) => m.type === "map_state");
    assert.equal(joinerMap.type, "map_state");
    if (joinerMap.type === "map_state") {
      assert.equal(joinerMap.geometry.length, getMap("rust_canyon").geometry.length);
    }

    // Invalid map rejected.
    const bad = await connect();
    clients.push(bad);
    const badJoin = await joinPublic(bad, "Bad Map", { mapId: "not_a_real_map" });
    assert.equal(badJoin.type, "join_rejected");
    if (badJoin.type === "join_rejected") {
      assert.equal(badJoin.reason, "map_invalid");
    }

    // Lobby lists map metadata + capacity 8.
    const lobbyViewer = await connect();
    clients.push(lobbyViewer);
    await sleep(150);
    const lobby = [...lobbyViewer.messages].reverse().find((m) => m.type === "lobby_state");
    assert.ok(lobby && lobby.type === "lobby_state");
    if (!lobby || lobby.type !== "lobby_state") throw new Error("unreachable");
    for (const match of lobby.matches) {
      assert.equal(match.maxPlayers, 8);
      assert.ok(typeof match.mapId === "string" && match.mapId.length > 0);
      assert.ok(typeof match.mapDisplayName === "string" && match.mapDisplayName.length > 0);
    }
    const canyonRow = lobby.matches.find((m) => m.id === themedMatchId);
    assert.ok(canyonRow);
    assert.equal(canyonRow?.mapId, "rust_canyon");
    assert.equal(canyonRow?.mapDisplayName, "Rust Canyon");
    assert.equal(canyonRow?.players, 2);

    console.log("[epic46-maps] PASS");
  } finally {
    for (const client of clients) client.ws.close();
    await stopServer(child);
  }
}

main().catch((err) => {
  console.error("[epic46-maps] FAIL", err);
  process.exit(1);
});
