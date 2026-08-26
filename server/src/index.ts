import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  PROTOCOL_VERSION,
  normalizeNickname,
  isAvatarBodyPart,
  isValidPaletteIndex,
  isMapId,
  DEFAULT_MAP_ID,
  type AccountCreatedMessage,
  type AccountLoginResultMessage,
  type AccountSessionResultMessage,
  type ClientMessage,
  type EconomyPool,
  type EndlessLeaderboardMessage,
  type JoinAcceptedMessage,
  type JoinRejectedMessage,
  type LeaderboardMessage,
  type LobbyStateMessage,
  type MapId,
  type ServerMessage,
  type WelcomeMessage,
} from "@cubewars/shared";
import { MatchManager } from "./matchManager.js";
import type { Match } from "./match.js";
import {
  EconomyStore,
  AuctionHouse,
  applyInventoryEconomyAction,
  toEconomyProfileMessage,
  type InventoryBagAction,
  type InventoryEconomyPayload,
} from "./economy/index.js";
import { AvatarProfileStore } from "./avatarProfile.js";
import { AccountStore } from "./accounts/index.js";
import { isSpawnProtected } from "./combat.js";

const PORT = Number(process.env.CUBEWARS_SERVER_PORT ?? 7777);

/**
 * EPIC 42: map a client message to a lobby inventory-family intent, or null
 * if the message is not inventory-family. Returns "malformed" when the type
 * matches but payload fields fail the same checks as the in-match path.
 */
function parseLobbyInventoryIntent(
  parsed: ClientMessage,
):
  | { action: InventoryBagAction; payload: InventoryEconomyPayload }
  | "malformed"
  | null {
  if (parsed.type === "economy_equip_pet") {
    if (typeof parsed.petId !== "number" || !Number.isInteger(parsed.petId)) return "malformed";
    const slot = parsed.slot === 2 ? 2 : parsed.slot === 1 ? 1 : undefined;
    if (slot === undefined) return "malformed";
    return { action: "equip", payload: { petId: parsed.petId, slot } };
  }
  if (parsed.type === "economy_unequip_pet") {
    if (typeof parsed.petId !== "number" || !Number.isInteger(parsed.petId)) return "malformed";
    return { action: "unequip", payload: { petId: parsed.petId } };
  }
  if (parsed.type === "economy_set_pet_color") {
    if (
      typeof parsed.petId !== "number" ||
      !Number.isInteger(parsed.petId) ||
      typeof parsed.paletteIndex !== "number"
    ) {
      return "malformed";
    }
    return {
      action: "set_pet_color",
      payload: { petId: parsed.petId, paletteIndex: parsed.paletteIndex },
    };
  }
  if (parsed.type === "economy_hatch_egg") {
    if (typeof parsed.eggId !== "number" || !Number.isInteger(parsed.eggId)) return "malformed";
    return { action: "hatch", payload: { eggId: parsed.eggId } };
  }
  if (parsed.type === "economy_apply_stimulator") {
    if (typeof parsed.eggId !== "number" || !Number.isInteger(parsed.eggId)) return "malformed";
    return { action: "stimulator", payload: { eggId: parsed.eggId } };
  }
  if (parsed.type === "economy_socket_gem") {
    if (
      typeof parsed.gemId !== "number" ||
      !Number.isInteger(parsed.gemId) ||
      typeof parsed.petId !== "number" ||
      !Number.isInteger(parsed.petId)
    ) {
      return "malformed";
    }
    return { action: "socket_gem", payload: { gemId: parsed.gemId, petId: parsed.petId } };
  }
  if (parsed.type === "economy_unsocket_gem") {
    if (typeof parsed.gemId !== "number" || !Number.isInteger(parsed.gemId)) return "malformed";
    return { action: "unsocket_gem", payload: { gemId: parsed.gemId } };
  }
  if (parsed.type === "economy_equip_amulet") {
    if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) return "malformed";
    return { action: "equip_amulet", payload: { amuletId: parsed.amuletId } };
  }
  if (parsed.type === "economy_unequip_amulet") {
    if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) return "malformed";
    return { action: "unequip_amulet", payload: { amuletId: parsed.amuletId } };
  }
  if (parsed.type === "economy_craft_amulet") {
    return { action: "craft_amulet", payload: {} };
  }
  if (parsed.type === "economy_repair_amulet") {
    if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) return "malformed";
    return { action: "repair_amulet", payload: { amuletId: parsed.amuletId } };
  }
  if (parsed.type === "economy_move_item") {
    if (
      typeof parsed.itemType !== "string" ||
      typeof parsed.itemId !== "number" ||
      !Number.isInteger(parsed.itemId) ||
      typeof parsed.toAnchor !== "number" ||
      !Number.isInteger(parsed.toAnchor)
    ) {
      return "malformed";
    }
    return {
      action: "move_item",
      payload: {
        itemType: parsed.itemType,
        itemId: parsed.itemId,
        toAnchor: parsed.toAnchor,
      },
    };
  }
  if (parsed.type === "economy_discard_item") {
    if (
      typeof parsed.itemType !== "string" ||
      typeof parsed.itemId !== "number" ||
      !Number.isInteger(parsed.itemId)
    ) {
      return "malformed";
    }
    return {
      action: "discard_item",
      payload: { itemType: parsed.itemType, itemId: parsed.itemId },
    };
  }
  return null;
}

async function main(): Promise<void> {
  let economyStore: EconomyStore;
  let avatarProfile: AvatarProfileStore;
  let accountStore: AccountStore;
  try {
    economyStore = await EconomyStore.open();
    avatarProfile = await AvatarProfileStore.open({
      redisUrl: economyStore.redisUrl,
      keyPrefix: economyStore.keyPrefix,
    });
    accountStore = await AccountStore.open({
      redisUrl: economyStore.redisUrl,
      keyPrefix: economyStore.keyPrefix,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const auctionHouse = AuctionHouse.fromStore(economyStore);
  // Settle expired lots periodically (24h window; tests use CUBEWARS_AUCTION_MS).
  setInterval(() => {
    void auctionHouse.tick().catch((err) => {
      console.error("[auction] tick failed:", err);
    });
  }, 5_000);

  // Flood guard: bound the total number of ANY client messages (input, fire,
// join, binary, oversized, non-JSON, unrecognized-type — literally anything
// arriving on the socket) accepted per connection within a trailing window,
// independent of what the client claims its own send rate is
// (global-standards.mdc "Rate-limit or debounce client input to prevent
// flooding"). This is a single shared per-connection rolling-window count
// cap across EVERY message shape (see messageTimestamps below): the check
// runs first, before binary/size/JSON-parse/type-dispatch, and a timestamp
// is stamped immediately once a message clears that check — BEFORE we know
// whether it will turn out to be binary, oversized, non-JSON, unknown-type,
// or a valid join/input/fire. That is deliberate: a connection that only
// ever sends garbage of any single shape must still be bounded by this cap
// (EPIC 4 F-001, both Critic REVISE rounds; carried through EPIC 9's match
// refactor — this guard is connection-scoped, not match-scoped, so it
// applies identically whether or not the connection has joined a match
// yet).
//
// EPIC 15 (`docs/tasks/epic-15-fire-input-debounce-fix.md`): this used to be
// a single shared "min interval since the last accepted message of ANY
// shape" debounce (`MIN_INPUT_INTERVAL_MS = 15`). That penalized a real
// client's independently-timed `input` (~30Hz) and `fire` (on click)
// streams for merely interleaving — one arriving inside the other's 15ms
// floor caused it to be dropped even though neither stream, on its own, was
// flooding anything. Replaced with a true sliding-window message-COUNT cap:
// at most MAX_MESSAGES_PER_WINDOW messages (of any shape) accepted per
// connection in the trailing FLOOD_WINDOW_MS. This needs no knowledge of
// message type (still pre-parse, per the constraint above) and no longer
// penalizes legitimate multi-stream traffic, while remaining tighter than
// the 185,800 msgs/sec flood EPIC 4's Critic actually reproduced against
// this exact code path — see the EPIC 15 doc Section 2 for the full
// derivation of these two numbers.
const FLOOD_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 100;

// Reject oversized payloads outright before attempting to parse JSON.
const MAX_MESSAGE_BYTES = 1024;

// Every "drop this message" path below (flood guard, fire cooldown, not
// joined yet, already joined, binary, oversized, non-JSON, unknown-type,
// malformed-input) logs in aggregate rather than one line per drop (that
// would just be a different flavor of log spam, and — per Critic F-001
// round 2 — synchronous console.warn calls at flood volumes could plausibly
// stall the single-threaded event loop and delay the tick for every player,
// not just the offending connection). Each drop path logs immediately on its
// first hit for a connection (so a flood shows up in the log right away),
// then at most once per this interval thereafter while it continues,
// summarizing how many messages were dropped since the last log line. Normal
// play never hits any drop path, so this produces zero extra log noise under
// normal play (security-baseline.mdc "log anomalous input patterns").
const FLOOD_LOG_INTERVAL_MS = 5000;

// Infosec F1 (EPIC 4 review): ws@8's own default maxPayload is 100 MiB — the
// library would fully buffer any frame up to that size into memory BEFORE
// the app-level MAX_MESSAGE_BYTES check below ever runs, undercutting the
// flood-guard work above (which only bounds message *rate*, not frame
// *size*). Setting maxPayload here makes ws itself reject/close oversized
// frames (code 1009) at the framing layer, before app code ever sees them.
// Reuses MAX_MESSAGE_BYTES rather than introducing a second magic number.
const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

// EPIC 9 "Bots & Match Modes": the server's game state is now N independent
// match instances (see match.ts / matchManager.ts) instead of one global
// PlayerRegistry/PickupSpawner/tick-interval. This module now only handles
// transport (WS connections, per-connection flood/rate-limit guards,
// message parsing/dispatch, join routing) — never game/simulation logic
// itself (global-standards.mdc: keep game logic separate from transport).
const matchManager = new MatchManager({
  onLeaderboardChanged: () => broadcastLobbyLeaderboard(),
  onEndlessLeaderboardChanged: () => broadcastLobbyEndlessLeaderboard(),
  economy: economyStore,
  avatarProfile,
});
await matchManager.hydrateFromEconomy();

// Shared across EVERY message shape a connection can send (join, input,
// fire, binary, oversized, non-JSON, unknown-type, malformed-input —
// literally anything the "message" handler below sees) — this is what the
// FLOOD_WINDOW_MS/MAX_MESSAGES_PER_WINDOW rolling-window count cap
// reads/writes: each connection's array of accepted-message timestamps,
// pruned to the trailing FLOOD_WINDOW_MS on every message (a true sliding
// window, not a fixed/resetting bucket — see EPIC 15 doc Section 2.3 for
// why a resetting bucket would allow a 2x burst at a bucket boundary).
// Bounded to at most MAX_MESSAGES_PER_WINDOW (100) entries per connection at
// any time. Connection-scoped (keyed by connection id, which never changes
// for the lifetime of one WS connection regardless of which match it later
// joins), same as before EPIC 9.
const messageTimestamps = new Map<string, number[]>();
const lastFireAcceptedAt = new Map<string, number>();

/**
 * Aggregate/throttled-logging "drop tracker" for a single drop reason. One
 * line per dropped message would just reproduce the log-spam / event-loop-
 * stall risk this pattern exists to avoid, so instead each reason tracks a
 * per-connection drop count and logs a summary immediately on the first
 * drop, then at most once per FLOOD_LOG_INTERVAL_MS while drops continue.
 */
function createDropTracker(describe: (playerId: string, count: number, extra?: string) => string) {
  const counts = new Map<string, number>();
  const lastLoggedAt = new Map<string, number>();
  return {
    // `extra` is optional free-form context appended by the caller (used by
    // fireCooldownDropTracker below to report the actual weapon-specific
    // cooldown that was exceeded) — every other tracker ignores it.
    record(playerId: string, now: number, extra?: string): void {
      const count = (counts.get(playerId) ?? 0) + 1;
      counts.set(playerId, count);
      const lastLogged = lastLoggedAt.get(playerId) ?? 0;
      if (lastLogged === 0 || now - lastLogged >= FLOOD_LOG_INTERVAL_MS) {
        console.warn(describe(playerId, count, extra));
        lastLoggedAt.set(playerId, now);
        counts.set(playerId, 0);
      }
    },
    clear(playerId: string): void {
      counts.delete(playerId);
      lastLoggedAt.delete(playerId);
    },
  };
}

const floodDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] flood guard: dropped ${count} message(s) from ${playerId} ` +
    `(exceeding ${MAX_MESSAGES_PER_WINDOW} messages / ${FLOOD_WINDOW_MS}ms window)`,
);
const fireCooldownDropTracker = createDropTracker(
  (playerId, count, extra) =>
    `[server] fire rate limit: dropped ${count} fire message(s) from ${playerId} ` +
    `(exceeding ${extra ?? "the equipped weapon's"} cooldown)`,
);
const binaryDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} binary message(s) from ${playerId}`,
);
const oversizedDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] dropped ${count} oversized message(s) from ${playerId} (limit ${MAX_MESSAGE_BYTES} bytes)`,
);
const nonJsonDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} malformed (non-JSON) message(s) from ${playerId}`,
);
const unknownTypeDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} message(s) with unknown type from ${playerId}`,
);
const malformedInputDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} out-of-range/malformed input message(s) from ${playerId}`,
);
// EPIC 9 Story 9.2 AC: "the player cannot send input/fire/switch_weapon
// before joining a mode" — every gameplay message type is rejected with this
// tracker until this connection's `join` has been processed.
const notJoinedDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] dropped ${count} gameplay message(s) from ${playerId} sent before joining a match`,
);
// A connection can only join once (no mode-switch mid-session, no session
// persistence per EPIC 9 spec Section 2) — a second "join" is dropped and
// logged as an anomaly rather than silently re-spawning/re-parenting the
// connection into a different match.
const alreadyJoinedDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} duplicate join message(s) from ${playerId} (already joined)`,
);

const lobbySockets = new Set<WebSocket>();

function lobbyStateMessage(): LobbyStateMessage {
  return { type: "lobby_state", matches: matchManager.listPublicMatches() };
}

function leaderboardMessage(): LeaderboardMessage {
  return { type: "leaderboard", entries: matchManager.listLeaderboard() };
}

function endlessLeaderboardMessage(): EndlessLeaderboardMessage {
  return { type: "endless_leaderboard", entries: matchManager.listEndlessLeaderboard() };
}

function sendJson(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcastLobbyState(): void {
  const message = lobbyStateMessage();
  for (const socket of lobbySockets) {
    sendJson(socket, message);
  }
}

function broadcastLobbyLeaderboard(): void {
  const message = leaderboardMessage();
  for (const socket of lobbySockets) {
    sendJson(socket, message);
  }
}

function broadcastLobbyEndlessLeaderboard(): void {
  const message = endlessLeaderboardMessage();
  for (const socket of lobbySockets) {
    sendJson(socket, message);
  }
}

console.log(`[server] cubewars game server listening on ws://localhost:${PORT}`);
console.log(`[server] tick rate: ${BROADCAST_TICK_HZ}Hz (per match — see server/src/match.ts)`);

/** Total currently-open WS connections (joined or not) — ops/logging visibility only, mirrors the pre-EPIC-9 "(${registry.size()} online)" log with a transport-level count now that there is no single global registry. */
let connectionCount = 0;

wss.on("connection", (socket: WebSocket) => {
  const playerId = randomUUID();
  connectionCount += 1;
  console.log(`[server] connection opened: ${playerId} (${connectionCount} connected)`);

  // EPIC 9: this connection is not a member of ANY match until it sends
  // "join" (see the "join" branch below / Match.addHuman()) — every other
  // message type is gated on `match` being non-null. `let`, not const:
  // reassigned exactly once, from null to the joined Match, by the "join"
  // branch below.
  let match: Match | null = null;
  let nickname: string = playerId;
  let nicknameKey: string = playerId.toLocaleLowerCase();
  /** True after a successful join or lobby bind — gates lobby auction/inventory. */
  let nicknameReady = false;
  /**
   * EPIC 45: which economy pool lobby inventory mutations use. Set by the last
   * successful `lobby_bind_nickname`. Auction always uses Deathmatch regardless.
   */
  let lobbyEconomyPool: EconomyPool = "deathmatch";
  /**
   * EPIC 45 F-001: incremented on every successful lobby bind sync path so
   * in-flight async profile pushes from an older bind are cancelled.
   */
  let lobbyBindGeneration = 0;
  /** EPIC 34: authenticated account for this connection (session-scoped). */
  let accountId: string | null = null;
  lobbySockets.add(socket);

  const welcome: WelcomeMessage = {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    serverTimeMs: Date.now(),
  };
  sendJson(socket, welcome);
  sendJson(socket, lobbyStateMessage());
  sendJson(socket, leaderboardMessage());
  sendJson(socket, endlessLeaderboardMessage());

  socket.on("message", (data, isBinary) => {
    // Rolling-window count check runs FIRST, before any
    // binary/size/parse/type-dispatch logic, and independent of message
    // shape (EPIC 4 F-001 round 2, preserved by EPIC 15): a connection that
    // has already had MAX_MESSAGES_PER_WINDOW messages accepted within the
    // trailing FLOOD_WINDOW_MS gets this one dropped here regardless of what
    // it would have turned out to be. True sliding window: timestamps older
    // than the trailing window are pruned on every message, so the cap is
    // never gamed by landing exactly on a fixed-bucket boundary (EPIC 15 doc
    // Section 2.3).
    const now = Date.now();
    const timestamps = messageTimestamps.get(playerId) ?? [];
    const windowStart = now - FLOOD_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < windowStart) timestamps.shift();
    if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) {
      floodDropTracker.record(playerId, now);
      return;
    }
    timestamps.push(now);
    messageTimestamps.set(playerId, timestamps);

    if (isBinary) {
      binaryDropTracker.record(playerId, now);
      return;
    }

    const raw = data.toString();
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
      oversizedDropTracker.record(playerId, now);
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      nonJsonDropTracker.record(playerId, now);
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      unknownTypeDropTracker.record(playerId, now);
      return;
    }

    // EPIC 34: account auth runs in the lobby (before join). These messages
    // must NOT be gated on match membership — they are identity, not gameplay.
    if (parsed.type === "account_register") {
      const email = parsed.email;
      void (async () => {
        if (accountId) {
          sendJson(socket, {
            type: "account_login_result",
            ok: false,
            reason: "already_authenticated",
          });
          return;
        }
        const result = await accountStore.register(email);
        if (result.status === "invalid_email") {
          sendJson(socket, {
            type: "account_login_result",
            ok: false,
            reason: "invalid_email",
          });
          return;
        }
        if (result.status === "exists") {
          // Ask the client for the code without revealing anything else.
          sendJson(socket, {
            type: "account_login_result",
            ok: false,
            reason: "code_required",
          });
          return;
        }
        accountId = result.account.accountId;
        sendJson(socket, {
          type: "account_created",
          accountId: result.account.accountId,
          email: result.account.email,
          code: result.code,
          token: result.token,
        });
      })().catch((err) => {
        console.error(`[server] account_register failed for ${playerId}:`, err);
        sendJson(socket, {
          type: "account_login_result",
          ok: false,
          reason: "invalid_credentials",
        });
      });
      return;
    }

    if (parsed.type === "account_login") {
      const email = parsed.email;
      const code = parsed.code;
      void (async () => {
        if (accountId) {
          sendJson(socket, {
            type: "account_login_result",
            ok: false,
            reason: "already_authenticated",
          });
          return;
        }
        const result = await accountStore.login(email, code, playerId);
        if (result.status === "ok") {
          accountId = result.account.accountId;
          sendJson(socket, {
            type: "account_login_result",
            ok: true,
            accountId: result.account.accountId,
            email: result.account.email,
            token: result.token,
          });
          return;
        }
        sendJson(socket, {
          type: "account_login_result",
          ok: false,
          reason:
            result.status === "rate_limited"
              ? "rate_limited"
              : result.status === "invalid_email"
                ? "invalid_email"
                : "invalid_credentials",
        });
      })().catch((err) => {
        console.error(`[server] account_login failed for ${playerId}:`, err);
        sendJson(socket, {
          type: "account_login_result",
          ok: false,
          reason: "invalid_credentials",
        });
      });
      return;
    }

    if (parsed.type === "account_session_resume") {
      const token = parsed.token;
      void (async () => {
        if (accountId) {
          sendJson(socket, {
            type: "account_session_result",
            ok: false,
            reason: "already_authenticated",
          });
          return;
        }
        const result = await accountStore.resumeSession(token);
        if (result.status === "ok") {
          accountId = result.account.accountId;
          sendJson(socket, {
            type: "account_session_result",
            ok: true,
            accountId: result.account.accountId,
            email: result.account.email,
          });
          return;
        }
        sendJson(socket, {
          type: "account_session_result",
          ok: false,
          reason: "invalid_token",
        });
      })().catch((err) => {
        console.error(`[server] account_session_resume failed for ${playerId}:`, err);
        sendJson(socket, {
          type: "account_session_result",
          ok: false,
          reason: "invalid_token",
        });
      });
      return;
    }

    if (parsed.type === "join") {
      if (match) {
        alreadyJoinedDropTracker.record(playerId, now);
        return;
      }
      if (parsed.mode !== "public" && parsed.mode !== "bots" && parsed.mode !== "endless") {
        unknownTypeDropTracker.record(playerId, now);
        return;
      }

      const normalized = normalizeNickname(parsed.nickname);
      if (!normalized.ok) {
        sendJson(socket, { type: "join_rejected", reason: "nickname_invalid" });
        return;
      }
      nickname = normalized.nickname;
      nicknameKey = normalized.key;
      nicknameReady = true;

      // EPIC 46: validate optional mapId for create paths; join-existing ignores it.
      let requestedMapId: MapId = DEFAULT_MAP_ID;
      if (parsed.mapId !== undefined) {
        if (!isMapId(parsed.mapId)) {
          sendJson(socket, { type: "join_rejected", reason: "map_invalid" });
          return;
        }
        requestedMapId = parsed.mapId;
      }

      void (async () => {
        if (parsed.type !== "join") return;
        if (parsed.mode === "public") {
          const joiningExisting =
            typeof parsed.matchId === "string" && parsed.matchId.length > 0;
          const requestedMatch = joiningExisting
            ? matchManager.getPublicMatch(parsed.matchId!)
            : null;
          const targetMatch =
            requestedMatch ??
            (joiningExisting ? null : matchManager.findOrCreatePublicMatch(requestedMapId));
          if (!targetMatch) {
            sendJson(socket, { type: "join_rejected", reason: "match_not_found" });
            return;
          }
          if (
            joiningExisting &&
            parsed.mapId !== undefined &&
            parsed.mapId !== targetMatch.mapId
          ) {
            console.log(
              `[server] join existing match "${targetMatch.id}": ignoring client mapId=${parsed.mapId} (server map=${targetMatch.mapId})`,
            );
          }
          if (targetMatch.hasNicknameKey(nicknameKey)) {
            sendJson(socket, { type: "join_rejected", reason: "nickname_taken" });
            return;
          }
          if (!targetMatch.canAcceptHuman()) {
            sendJson(socket, { type: "join_rejected", reason: "match_full" });
            return;
          }
          match = targetMatch;
        } else if (parsed.mode === "bots") {
          if (nicknameKey === "bot 1" || nicknameKey === "bot 2") {
            sendJson(socket, { type: "join_rejected", reason: "nickname_taken" });
            return;
          }
          match = matchManager.createBotsMatch(playerId, requestedMapId);
        } else {
          match = matchManager.createEndlessMatch(playerId);
        }

        lobbySockets.delete(socket);
        await match.addHuman(playerId, socket, nickname, nicknameKey);
        const accepted: JoinAcceptedMessage = { type: "join_accepted", matchId: match.id, nickname };
        sendJson(socket, accepted);
        sendJson(socket, leaderboardMessage());
        sendJson(socket, endlessLeaderboardMessage());
        console.log(
          `[server] player joined match "${match.id}" (mode=${parsed.mode} map=${match.mapId}): ${nickname} (${playerId}) ` +
            `(${match.humanCount()} human(s) in match)`,
        );
        broadcastLobbyState();
        broadcastLobbyLeaderboard();
        broadcastLobbyEndlessLeaderboard();
      })().catch((err) => {
        console.error(`[server] join failed for ${playerId}:`, err);
        sendJson(socket, { type: "join_rejected", reason: "match_not_found" });
        match = null;
        lobbySockets.add(socket);
      });
      return;
    }

    // EPIC 38/45: auction house is Deathmatch-pool global — available in lobby
    // after nicknameReady (join or lobby_bind_nickname), and inside any match.
    // Always mutates deathmatch pool only (never sandbox).
    const isAuctionMsg =
      parsed.type === "economy_auction_list" ||
      parsed.type === "economy_auction_bid" ||
      parsed.type === "economy_auction_buyout" ||
      parsed.type === "economy_auction_browse";
    if (isAuctionMsg) {
      if (!nicknameReady) {
        notJoinedDropTracker.record(playerId, now);
        return;
      }
      void (async () => {
        const sendResult = (
          action: import("@cubewars/shared").EconomyActionResultMessage["action"],
          ok: boolean,
          code?: string,
        ) => {
          sendJson(socket, { type: "economy_action_result", action, ok, code });
        };
        const pushAuctionState = async () => {
          const state = await auctionHouse.listActiveLots(nickname);
          sendJson(socket, {
            type: "economy_auction_state",
            lots: state.lots,
            developerGoldLedger: state.developerGoldLedger,
          });
        };
        const pushDeathmatchProfileIfSafe = async () => {
          // Only overwrite the client's inventory snapshot when they are in a
          // Deathmatch match (or lobby) — never clobber a Sandbox profile.
          if (match && match.mode !== "public") return;
          const profile = await economyStore.getFullProfile(nickname, "deathmatch");
          sendJson(socket, toEconomyProfileMessage(profile, "deathmatch"));
        };
        try {
          if (parsed.type === "economy_auction_browse") {
            sendResult("auction_browse", true);
            await pushAuctionState();
            return;
          }
          if (parsed.type === "economy_auction_list") {
            if (
              typeof parsed.itemType !== "string" ||
              typeof parsed.itemId !== "number" ||
              typeof parsed.startPrice !== "number"
            ) {
              sendResult("auction_list", false, "invalid_price");
              return;
            }
            await auctionHouse.listItem(
              nickname,
              parsed.itemType,
              parsed.itemId,
              parsed.startPrice,
              parsed.buyoutPrice ?? null,
              Date.now(),
              parsed.shardQuantity,
            );
            sendResult("auction_list", true);
            await pushDeathmatchProfileIfSafe();
            await pushAuctionState();
            return;
          }
          if (parsed.type === "economy_auction_bid") {
            if (typeof parsed.lotId !== "number" || typeof parsed.amount !== "number") {
              sendResult("auction_bid", false, "invalid_price");
              return;
            }
            await auctionHouse.bid(nickname, parsed.lotId, parsed.amount, Date.now());
            sendResult("auction_bid", true);
            await pushDeathmatchProfileIfSafe();
            await pushAuctionState();
            return;
          }
          if (parsed.type === "economy_auction_buyout") {
            if (typeof parsed.lotId !== "number") {
              sendResult("auction_buyout", false, "invalid_price");
              return;
            }
            await auctionHouse.buyout(nickname, parsed.lotId, Date.now());
            sendResult("auction_buyout", true);
            await pushDeathmatchProfileIfSafe();
            await pushAuctionState();
            return;
          }
        } catch (err) {
          const action =
            parsed.type === "economy_auction_list"
              ? "auction_list"
              : parsed.type === "economy_auction_bid"
                ? "auction_bid"
                : parsed.type === "economy_auction_buyout"
                  ? "auction_buyout"
                  : "auction_browse";
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code: string }).code)
              : "not_found";
          sendResult(action, false, code);
        }
      })();
      return;
    }

    // EPIC 42/45: bind nickname in lobby without joining a match, then push
    // the requested pool's economy_profile so inventory/auction can open pre-match.
    if (parsed.type === "lobby_bind_nickname") {
      if (match) {
        // Already in a match — refresh the live match-scoped profile only.
        void match.sendEconomyProfile(playerId, nickname);
        sendJson(socket, { type: "economy_action_result", action: "lobby_bind", ok: true });
        return;
      }
      const rawPool = (parsed as { economyPool?: unknown }).economyPool;
      let requestedPool: EconomyPool = "deathmatch";
      if (rawPool !== undefined) {
        if (rawPool !== "deathmatch" && rawPool !== "sandbox") {
          sendJson(socket, {
            type: "economy_action_result",
            action: "lobby_bind",
            ok: false,
            code: "pool_invalid",
          });
          return;
        }
        requestedPool = rawPool;
      }
      const normalized = normalizeNickname(parsed.nickname);
      if (!normalized.ok) {
        sendJson(socket, {
          type: "economy_action_result",
          action: "lobby_bind",
          ok: false,
          code: "nickname_invalid",
        });
        return;
      }
      nickname = normalized.nickname;
      nicknameKey = normalized.key;
      nicknameReady = true;
      lobbyEconomyPool = requestedPool;
      const bindGeneration = ++lobbyBindGeneration;
      void (async () => {
        try {
          // Test-only stall so overlapping dual-bind races are reproducible in
          // regression (CUBEWARS_TEST_LOBBY_BIND_STALL_MS / _STALL_POOL).
          const stallMs = Number(process.env.CUBEWARS_TEST_LOBBY_BIND_STALL_MS ?? 0);
          const stallPool = process.env.CUBEWARS_TEST_LOBBY_BIND_STALL_POOL;
          if (
            Number.isFinite(stallMs) &&
            stallMs > 0 &&
            (!stallPool || stallPool === requestedPool)
          ) {
            await new Promise((resolve) => setTimeout(resolve, stallMs));
          }
          if (bindGeneration !== lobbyBindGeneration) {
            console.log(
              `[lobby/${requestedPool}] skipping stale bind profile (gen ${bindGeneration} < ${lobbyBindGeneration})`,
            );
            return;
          }
          const profile = await economyStore.getFullProfile(nickname, requestedPool);
          if (bindGeneration !== lobbyBindGeneration) {
            console.log(
              `[lobby/${requestedPool}] skipping stale bind profile after fetch (gen ${bindGeneration} < ${lobbyBindGeneration})`,
            );
            return;
          }
          sendJson(socket, toEconomyProfileMessage(profile, requestedPool));
          sendJson(socket, { type: "economy_action_result", action: "lobby_bind", ok: true });
          console.log(
            `[lobby/${requestedPool}] nickname bound for inventory: ${nickname} (${playerId})`,
          );
        } catch (err) {
          if (bindGeneration !== lobbyBindGeneration) return;
          console.error(`[lobby/${requestedPool}] bind profile failed for ${playerId}:`, err);
          sendJson(socket, {
            type: "economy_action_result",
            action: "lobby_bind",
            ok: false,
            code: "not_found",
          });
        }
      })();
      return;
    }

    // EPIC 42/45: inventory-family + appearance from lobby when nicknameReady
    // and not yet in a match. Mutations use the connection's bound lobby pool
    // only (never cross pools). Drop/trade/ground stay match-only.
    if (!match && nicknameReady) {
      const lobbyInventory = parseLobbyInventoryIntent(parsed);
      if (lobbyInventory === "malformed") {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      if (lobbyInventory) {
        const intent = lobbyInventory;
        const pool = lobbyEconomyPool;
        void (async () => {
          const result = await applyInventoryEconomyAction(
            economyStore,
            nickname,
            pool,
            intent.action,
            intent.payload,
            Date.now(),
          );
          sendJson(socket, {
            type: "economy_action_result",
            action: intent.action,
            ok: result.ok,
            code: result.ok ? undefined : result.code,
          });
          if (result.ok) {
            const profile = await economyStore.getFullProfile(nickname, pool);
            sendJson(socket, toEconomyProfileMessage(profile, pool));
            console.log(`[economy] ${intent.action} ok for ${nickname} [lobby/${pool}]`);
          } else {
            console.warn(
              `[economy] ${intent.action} rejected for ${nickname} [lobby/${pool}]: ${result.code}`,
            );
          }
        })();
        return;
      }

      if (
        parsed.type === "economy_drop_item" ||
        parsed.type === "economy_pickup_ground" ||
        parsed.type === "economy_trade_open" ||
        parsed.type === "economy_trade_offer" ||
        parsed.type === "economy_trade_confirm" ||
        parsed.type === "economy_trade_cancel"
      ) {
        const action =
          parsed.type === "economy_drop_item"
            ? "drop_item"
            : parsed.type === "economy_pickup_ground"
              ? "pickup_ground"
              : parsed.type === "economy_trade_open"
                ? "trade_open"
                : parsed.type === "economy_trade_offer"
                  ? "trade_offer"
                  : parsed.type === "economy_trade_confirm"
                    ? "trade_confirm"
                    : "trade_cancel";
        sendJson(socket, {
          type: "economy_action_result",
          action,
          ok: false,
          code: "match_required",
        });
        return;
      }

      if (parsed.type === "avatar_set_color") {
        if (!isAvatarBodyPart(parsed.part) || !isValidPaletteIndex(parsed.paletteIndex)) {
          malformedInputDropTracker.record(playerId, now);
          return;
        }
        void (async () => {
          try {
            await avatarProfile.setPart(nicknameKey, parsed.part, parsed.paletteIndex);
            console.log(
              `[avatar] lobby set ${parsed.part}=${parsed.paletteIndex} for ${nickname}`,
            );
          } catch (err) {
            console.error(`[avatar] lobby set failed for ${playerId}:`, err);
          }
        })();
        return;
      }
    }

    // Every other message type is gameplay-relevant and requires an active
    // match membership first (EPIC 9 Story 9.2 AC / security-baseline.mdc
    // "reject what shouldn't be trusted") — a connection that hasn't sent
    // "join" yet cannot move, fire, or switch weapons in any match.
    if (!match) {
      notJoinedDropTracker.record(playerId, now);
      return;
    }

    if (parsed.type === "input") {
      const accepted = match.registry.applyInput(playerId, parsed);
      if (!accepted) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      return;
    }

    if (parsed.type === "fire") {
      // Dead players can't fire (Story 4.2 AC) — not logged as an anomaly,
      // this is an expected race while a client's own respawn state is
      // still in flight.
      if (!match.registry.isAlive(playerId)) return;

      // EPIC 41: spawn-protected shooters cannot fire — skip before the
      // cooldown stamp so a blocked attempt does not burn rate-of-fire.
      // registry.fire() also gates this authoritatively; this avoids an
      // unfair lastFireAcceptedAt advance on a no-op.
      const shooter = match.registry.getPlayer(playerId);
      if (shooter && isSpawnProtected(shooter, now)) return;

      // EPIC 6: the rate-of-fire cap is the shooter's own equipped weapon's
      // cooldown (WEAPON_STATS[...].cooldownMs), read fresh every fire
      // attempt from the server's own authoritative record — never a single
      // fixed constant, and never anything the client asserts.
      const cooldownMs = match.registry.getFireCooldownMs(playerId);
      const lastFire = lastFireAcceptedAt.get(playerId) ?? 0;
      if (now - lastFire < cooldownMs) {
        fireCooldownDropTracker.record(playerId, now, `${cooldownMs}ms`);
        return;
      }
      lastFireAcceptedAt.set(playerId, now);

      // match.resolveFire() performs the actual authoritative hitscan
      // (server/src/combat.ts, via registry.fire()) from the shooter's own
      // server-tracked position/yaw/pitch/equipped-weapon, and broadcasts
      // whatever it resolved to (hit/death/kill) scoped to this match only
      // — nothing here trusts anything the client sent beyond "I fired now"
      // (security-baseline.mdc).
      match.resolveFire(playerId);
      return;
    }

    if (parsed.type === "switch_weapon") {
      // EPIC 6 Story 6.2 "E" key: server-decided "cycle to the next OWNED
      // weapon in tier order" — see registry.cycleWeapon() doc comment for
      // why this carries no client-supplied target weapon. Returns false
      // (no-op, nothing broadcast/logged) if there's nothing to cycle to.
      const changed = match.registry.cycleWeapon(playerId);
      if (changed) {
        match.sendLoadout(playerId);
        const loadout = match.registry.getLoadout(playerId);
        console.log(`[server] [${match.id}] switch: ${playerId} -> ${loadout?.equippedWeapon ?? "?"}`);
      }
      return;
    }

    if (parsed.type === "economy_equip_pet") {
      if (typeof parsed.petId !== "number" || !Number.isInteger(parsed.petId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      const slot = parsed.slot === 2 ? 2 : parsed.slot === 1 ? 1 : undefined;
      if (slot === undefined) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "equip", {
        petId: parsed.petId,
        slot,
      });
      return;
    }

    if (parsed.type === "economy_unequip_pet") {
      if (typeof parsed.petId !== "number" || !Number.isInteger(parsed.petId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "unequip", { petId: parsed.petId });
      return;
    }

    if (parsed.type === "economy_set_pet_color") {
      if (
        typeof parsed.petId !== "number" ||
        !Number.isInteger(parsed.petId) ||
        typeof parsed.paletteIndex !== "number"
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "set_pet_color", {
        petId: parsed.petId,
        paletteIndex: parsed.paletteIndex,
      });
      return;
    }

    if (parsed.type === "economy_hatch_egg") {
      if (typeof parsed.eggId !== "number" || !Number.isInteger(parsed.eggId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "hatch", { eggId: parsed.eggId });
      return;
    }

    if (parsed.type === "economy_apply_stimulator") {
      if (typeof parsed.eggId !== "number" || !Number.isInteger(parsed.eggId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "stimulator", { eggId: parsed.eggId });
      return;
    }

    if (parsed.type === "economy_socket_gem") {
      if (
        typeof parsed.gemId !== "number" ||
        !Number.isInteger(parsed.gemId) ||
        typeof parsed.petId !== "number" ||
        !Number.isInteger(parsed.petId)
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "socket_gem", {
        gemId: parsed.gemId,
        petId: parsed.petId,
      });
      return;
    }

    if (parsed.type === "economy_unsocket_gem") {
      if (typeof parsed.gemId !== "number" || !Number.isInteger(parsed.gemId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "unsocket_gem", { gemId: parsed.gemId });
      return;
    }

    if (parsed.type === "economy_equip_amulet") {
      if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "equip_amulet", { amuletId: parsed.amuletId });
      return;
    }

    if (parsed.type === "economy_unequip_amulet") {
      if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "unequip_amulet", { amuletId: parsed.amuletId });
      return;
    }

    if (parsed.type === "economy_craft_amulet") {
      void match.handleEconomyAction(playerId, nickname, "craft_amulet", {});
      return;
    }

    if (parsed.type === "economy_repair_amulet") {
      if (typeof parsed.amuletId !== "number" || !Number.isInteger(parsed.amuletId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "repair_amulet", { amuletId: parsed.amuletId });
      return;
    }

    if (parsed.type === "economy_move_item") {
      if (
        typeof parsed.itemType !== "string" ||
        typeof parsed.itemId !== "number" ||
        !Number.isInteger(parsed.itemId) ||
        typeof parsed.toAnchor !== "number" ||
        !Number.isInteger(parsed.toAnchor)
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "move_item", {
        itemType: parsed.itemType,
        itemId: parsed.itemId,
        toAnchor: parsed.toAnchor,
      });
      return;
    }

    if (parsed.type === "economy_discard_item") {
      if (
        typeof parsed.itemType !== "string" ||
        typeof parsed.itemId !== "number" ||
        !Number.isInteger(parsed.itemId)
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleEconomyAction(playerId, nickname, "discard_item", {
        itemType: parsed.itemType,
        itemId: parsed.itemId,
      });
      return;
    }

    if (parsed.type === "economy_drop_item") {
      if (
        typeof parsed.itemType !== "string" ||
        typeof parsed.itemId !== "number" ||
        !Number.isInteger(parsed.itemId)
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleDropItem(playerId, nickname, parsed.itemType, parsed.itemId);
      return;
    }

    if (parsed.type === "economy_pickup_ground") {
      if (typeof parsed.groundId !== "number" || !Number.isInteger(parsed.groundId)) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handlePickupGround(playerId, nickname, parsed.groundId);
      return;
    }

    if (parsed.type === "economy_trade_open") {
      if (typeof parsed.partnerId !== "string" || parsed.partnerId.length === 0) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleTradeOpen(playerId, nickname, parsed.partnerId);
      return;
    }

    if (parsed.type === "economy_trade_offer") {
      if (
        typeof parsed.tradeId !== "string" ||
        typeof parsed.gold !== "number" ||
        !Array.isArray(parsed.items)
      ) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleTradeOffer(playerId, nickname, parsed.tradeId, parsed.gold, parsed.items);
      return;
    }

    if (parsed.type === "economy_trade_confirm") {
      if (typeof parsed.tradeId !== "string") {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleTradeConfirm(playerId, nickname, parsed.tradeId);
      return;
    }

    if (parsed.type === "economy_trade_cancel") {
      if (typeof parsed.tradeId !== "string") {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      void match.handleTradeCancel(playerId, parsed.tradeId);
      return;
    }

    if (parsed.type === "avatar_set_color") {
      void (async () => {
        const ok = await match.handleAvatarSetColor(
          playerId,
          nickname,
          nicknameKey,
          parsed.part,
          parsed.paletteIndex,
        );
        if (!ok) {
          malformedInputDropTracker.record(playerId, Date.now());
        }
      })();
      return;
    }

    unknownTypeDropTracker.record(playerId, now);
  });

  socket.on("close", () => {
    // EPIC 9: tears down this connection's match membership (and, for a
    // "bots" match whose last human this was, the whole match — see
    // Match.removeHuman() / MatchManager). No-op if this connection never
    // joined any match.
    if (match) {
      match.removeHuman(playerId);
      broadcastLobbyState();
      broadcastLobbyLeaderboard();
      broadcastLobbyEndlessLeaderboard();
    }
    lobbySockets.delete(socket);
    connectionCount -= 1;
    messageTimestamps.delete(playerId);
    lastFireAcceptedAt.delete(playerId);
    floodDropTracker.clear(playerId);
    fireCooldownDropTracker.clear(playerId);
    binaryDropTracker.clear(playerId);
    oversizedDropTracker.clear(playerId);
    nonJsonDropTracker.clear(playerId);
    unknownTypeDropTracker.clear(playerId);
    malformedInputDropTracker.clear(playerId);
    notJoinedDropTracker.clear(playerId);
    alreadyJoinedDropTracker.clear(playerId);
    console.log(
      `[server] connection closed: ${playerId} (${connectionCount} connected, ${matchManager.size()} live match(es))`,
    );
  });

  socket.on("error", (err) => {
    console.error(`[server] socket error for ${playerId}:`, err);
  });
});

wss.on("error", (err) => {
  console.error("[server] WebSocketServer error:", err);
});

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  void accountStore
    .close()
    .catch(() => undefined)
    .finally(() => {
      void avatarProfile
        .close()
        .catch(() => undefined)
        .finally(() => {
          void economyStore.close().finally(() => {
            wss.close(() => process.exit(0));
          });
        });
    });
});
} // end main()

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
