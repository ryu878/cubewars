// Transport layer only — no game/simulation logic here (per global-standards.mdc).

import type {
  ClientMessage,
  DeathEvent,
  EndlessLeaderboardMessage,
  EndlessStateMessage,
  FireBroadcastEvent,
  HitEvent,
  JoinAcceptedMessage,
  JoinRejectedMessage,
  KillEvent,
  LeaderboardMessage,
  LoadoutMessage,
  LobbyStateMessage,
  MapStateMessage,
  PickupStateMessage,
  ProjectileImpactEvent,
  RespawnEvent,
  ScoreboardMessage,
  ServerMessage,
  WorldStateMessage,
} from "@cubewars/shared";

export interface NetworkHandlers {
  onOpen?: () => void;
  onWelcome: (playerId: string) => void;
  onWorldState: (message: WorldStateMessage) => void;
  onLobbyState?: (message: LobbyStateMessage) => void;
  onJoinAccepted?: (message: JoinAcceptedMessage) => void;
  onJoinRejected?: (message: JoinRejectedMessage) => void;
  onLeaderboard?: (message: LeaderboardMessage) => void;
  onEndlessLeaderboard?: (message: EndlessLeaderboardMessage) => void;
  onEndlessState?: (message: EndlessStateMessage) => void;
  onMapState?: (message: MapStateMessage) => void;
  /** A fire event resolved to a confirmed hit somewhere (EPIC 4 Story 4.1) — cosmetic feedback trigger only, not the source of truth for health (see WorldStateMessage.players[].health for that). */
  onHit?: (message: HitEvent) => void;
  /** A player's health reached 0 (EPIC 4 Story 4.2) — cosmetic feedback trigger only. */
  onDeath?: (message: DeathEvent) => void;
  /** A previously-dead player respawned (EPIC 4 Story 4.2) — cosmetic feedback trigger only. */
  onRespawn?: (message: RespawnEvent) => void;
  /** A kill happened (EPIC 5 Story 5.1) — drives the transient kill-feed line, broadcast to every client. */
  onKill?: (message: KillEvent) => void;
  /** The full current scoreboard (EPIC 5 Story 5.2) — always a complete replacement list, never a delta. */
  onScoreboard?: (message: ScoreboardMessage) => void;
  /** This client's own current weapon/ammo loadout (EPIC 6) — private to this connection, drives the weapon HUD. */
  onLoadout?: (message: LoadoutMessage) => void;
  /** The full current on/off state of every world pickup (EPIC 6 Story 6.1) — always a complete replacement list, never a delta. */
  onPickupState?: (message: PickupStateMessage) => void;
  /** Someone in this match attempted to fire (EPIC 14 "Sound System" Story 14.4) — a presentational-only, best-effort broadcast on every fire attempt (hit, miss, or dry), used purely to trigger the remote gunshot sound. Carries no aim/damage/outcome data; HitEvent above remains the sole source of truth for whether a shot actually landed. */
  onFireBroadcast?: (message: FireBroadcastEvent) => void;
  /** A server-simulated projectile impacted something; cosmetic only. */
  onProjectileImpact?: (message: ProjectileImpactEvent) => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
}

export class GameConnection {
  private socket: WebSocket;

  constructor(url: string, handlers: NetworkHandlers) {
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => handlers.onOpen?.());

    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "welcome") {
          handlers.onWelcome(message.playerId);
        } else if (message.type === "world_state") {
          handlers.onWorldState(message);
        } else if (message.type === "lobby_state") {
          handlers.onLobbyState?.(message);
        } else if (message.type === "join_accepted") {
          handlers.onJoinAccepted?.(message);
        } else if (message.type === "join_rejected") {
          handlers.onJoinRejected?.(message);
        } else if (message.type === "leaderboard") {
          handlers.onLeaderboard?.(message);
        } else if (message.type === "endless_leaderboard") {
          handlers.onEndlessLeaderboard?.(message);
        } else if (message.type === "endless_state") {
          handlers.onEndlessState?.(message);
        } else if (message.type === "map_state") {
          handlers.onMapState?.(message);
        } else if (message.type === "hit") {
          handlers.onHit?.(message);
        } else if (message.type === "death") {
          handlers.onDeath?.(message);
        } else if (message.type === "respawn") {
          handlers.onRespawn?.(message);
        } else if (message.type === "kill") {
          handlers.onKill?.(message);
        } else if (message.type === "scoreboard") {
          handlers.onScoreboard?.(message);
        } else if (message.type === "loadout") {
          handlers.onLoadout?.(message);
        } else if (message.type === "pickup_state") {
          handlers.onPickupState?.(message);
        } else if (message.type === "fire_broadcast") {
          handlers.onFireBroadcast?.(message);
        } else if (message.type === "projectile_impact") {
          handlers.onProjectileImpact?.(message);
        }
      } catch (err) {
        console.error("[client] failed to parse server message", err);
      }
    });

    this.socket.addEventListener("close", () => handlers.onClose?.());
    this.socket.addEventListener("error", (err) => handlers.onError?.(err));
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
