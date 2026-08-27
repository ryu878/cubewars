import * as THREE from "three";
import {
  ARENA_BOUNDS,
  ARENA_GEOMETRY,
  COMBAT,
  DEFAULT_MAP_ID,
  PICKUP_RADIUS,
  WEAPON_STATS,
  listMaps,
  type EconomyPool,
  type MapBox,
  type MapId,
  type MatchMode,
  type PlayerInputMessage,
  type WeaponType,
  type WorldStateMessage,
} from "@cubewars/shared";
import { GameConnection } from "./network";
import { FpsController } from "./fpsController";
import { RemotePlayers } from "./remotePlayers";
import { CombatHud } from "./combatHud";
import { KillFeed } from "./killFeed";
import { Scoreboard } from "./scoreboard";
import { PickupRenderer } from "./pickups";
import { ModeSelect } from "./modeSelect";
import { AccountAuth } from "./accountAuth";
import { InventoryOverlay } from "./inventoryOverlay";
import { AuctionPanel } from "./auctionPanel";
import { TradePanel } from "./tradePanel";
import { GroundHud } from "./groundHud";
import { WeaponViewmodel } from "./viewmodel";
import { buildWallTextures, createFogFadeWallMaterial } from "./textures";
import {
  applyMapTheme,
  getPalette,
  themeIdFromMapState,
  type MapThemeScene,
} from "./mapThemes";
import { propMaterialKind } from "./propMaterialKind";
import { SoundManager } from "./audio/soundManager";
import { CombatEffects } from "./combatEffects";
import { KillLootVfx } from "./killLootVfx";
import { PauseMenu } from "./pauseMenu";
import { DevConsole } from "./devConsole";
import { isLobbyVisible, isPauseMenuVisible, shouldIgnoreGameHotkey } from "./uiInput";
import { applyI18nDom, localizedMapName, subscribe, t, wireLocaleSwitcher } from "./i18n";

// EPIC 52: apply saved/browser locale to static HTML, then keep switcher live.
wireLocaleSwitcher();
applyI18nDom();
subscribe(() => {
  applyI18nDom();
});

const statusEl = document.getElementById("status") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;
const endlessHudEl = document.getElementById("endlessHud") as HTMLDivElement;
const endlessDistanceEl = document.getElementById("endlessDistance") as HTMLSpanElement;
const endlessKillsEl = document.getElementById("endlessKills") as HTMLSpanElement;
const endlessFogEl = document.getElementById("endlessFog") as HTMLSpanElement;

// --- Scene: sandy/tan de_dust-inspired arena (EPIC 3), gradient sky (EPIC 10) ---
// EPIC 49: fog/sky/lights/ground follow per-MapId palettes via applyMapTheme.
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf3d9a8, 120, 700);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
// EPIC 10 Story 10.1: the camera must be part of the scene graph for its
// child viewmodel (added below, see WeaponViewmodel) to actually render —
// renderer.render(scene, camera) only draws what's reachable from `scene`.
// This does not change camera behavior; fpsController.ts still owns and
// drives camera.position/rotation exactly as before.
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
appEl.appendChild(renderer.domElement);

// --- Lighting (avoid the flat/grey default-Three.js look; warm desert bounce light) ---
const hemiLight = new THREE.HemisphereLight(0xfff3d6, 0x8a7355, 0.95);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff0d0, 1.3);
sunLight.position.set(20, 30, 10);
scene.add(sunLight);

// --- Ground: sandy plane sized to the arena's outer envelope (shared/mapData.ts) ---
const groundWidth = ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX + 8;
const groundDepth = ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ + 8;
let groundGeo = new THREE.PlaneGeometry(groundWidth, groundDepth);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xe3c98c }); // sandy tan
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const themeScene: MapThemeScene = {
  scene,
  groundMat,
  hemiLight,
  sunLight,
  skyDome: null,
};
applyMapTheme("lobby", themeScene);

// --- Arena geometry: render every wall/crate from the shared, server-matching
// AABB list (EPIC 3 Story 3.2) — this is the ONE layout definition, also used
// for collision in fpsController.ts and server/src/playerRegistry.ts.
//
// EPIC 10 Story 10.2: wood/brick CanvasTextures built ONCE at scene setup.
// EPIC 49: tint walls/crates from active palette; props use id-prefix materials
// (wheels, car body, tanks, crystals, rubble, veg, cables…). ---
const WALL_TEXTURE_TILE_SIZE = 2; // world units per texture tile, both wood & brick
const wallTextures = buildWallTextures();
const mapGeometryGroup = new THREE.Group();
scene.add(mapGeometryGroup);
const fogWall = new THREE.Mesh(
  new THREE.BoxGeometry(52, 5, 0.35),
  new THREE.MeshStandardMaterial({
    color: 0x7a2f3a,
    transparent: true,
    opacity: 0.38,
    emissive: 0x4a1018,
    emissiveIntensity: 0.35,
  }),
);
fogWall.position.y = 2.5;
fogWall.visible = false;
scene.add(fogWall);

function disposeMeshMaterial(material: THREE.Material): void {
  if ("map" in material && material.map instanceof THREE.Texture) {
    material.map.dispose();
  }
  material.dispose();
}

/** Prop materials by landmark id patterns — not one grey metal for everything. */
function materialForProp(box: MapBox): THREE.MeshStandardMaterial {
  const palette = getPalette();
  const kind = propMaterialKind(box.id);

  if (kind === "wheel") {
    return new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      metalness: 0.15,
      roughness: 0.92,
      emissive: 0x050505,
      emissiveIntensity: 0.05,
    });
  }
  if (kind === "cabin") {
    return new THREE.MeshStandardMaterial({
      color: 0x2a3540,
      metalness: 0.35,
      roughness: 0.35,
      emissive: 0x0a1520,
      emissiveIntensity: 0.12,
    });
  }
  if (kind === "rock") {
    return new THREE.MeshStandardMaterial({
      color: 0x6a6460,
      metalness: 0.08,
      roughness: 0.95,
      emissive: 0x101010,
      emissiveIntensity: 0.06,
    });
  }
  if (kind === "body") {
    return new THREE.MeshStandardMaterial({
      color: palette.propAccent,
      metalness: 0.45,
      roughness: 0.5,
      emissive: 0x101010,
      emissiveIntensity: 0.08,
    });
  }
  if (kind === "tank_green") {
    return new THREE.MeshStandardMaterial({
      color: 0x4a5a38,
      metalness: 0.6,
      roughness: 0.4,
      emissive: 0x101408,
      emissiveIntensity: 0.12,
    });
  }
  if (kind === "tank_fuel") {
    return new THREE.MeshStandardMaterial({
      color: 0xb05020,
      metalness: 0.55,
      roughness: 0.42,
      emissive: 0x201008,
      emissiveIntensity: 0.1,
    });
  }
  if (kind === "crystal") {
    return new THREE.MeshStandardMaterial({
      color: palette.propAccent,
      metalness: 0.2,
      roughness: 0.25,
      emissive: palette.emissiveAccent,
      emissiveIntensity: palette.emissiveIntensity,
    });
  }
  if (kind === "veg") {
    return new THREE.MeshStandardMaterial({
      color: 0x3a7a40,
      metalness: 0.05,
      roughness: 0.88,
      emissive: 0x102010,
      emissiveIntensity: 0.15,
    });
  }
  if (kind === "cable") {
    return new THREE.MeshStandardMaterial({
      color: 0x2a2c30,
      metalness: 0.75,
      roughness: 0.35,
      emissive: 0x080808,
      emissiveIntensity: 0.08,
    });
  }
  if (kind === "structure") {
    return new THREE.MeshStandardMaterial({
      color: 0x6a7080,
      metalness: 0.4,
      roughness: 0.55,
      emissive: 0x101418,
      emissiveIntensity: 0.1,
    });
  }
  if (kind === "pipe") {
    return new THREE.MeshStandardMaterial({
      color: 0x708090,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x101418,
      emissiveIntensity: 0.1,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: palette.propMetal,
    metalness: 0.55,
    roughness: 0.45,
    emissive: palette.emissiveAccent,
    emissiveIntensity: Math.min(0.2, palette.emissiveIntensity),
  });
}

function renderMapGeometry(boxes: readonly MapBox[]): void {
  for (const child of mapGeometryGroup.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) disposeMeshMaterial(material);
      } else {
        disposeMeshMaterial(child.material);
      }
    }
  }
  mapGeometryGroup.clear();
  const palette = getPalette();
  boxes.forEach((box, index) => {
    const geometry = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z);
    let material: THREE.MeshStandardMaterial;

    if (box.kind === "prop") {
      material = materialForProp(box);
    } else {
      // Vegetation crates: solid green (no wood/brick) so lab plants read clearly.
      if (box.id.includes("veg") || box.id.includes("_bush_") || box.id.includes("_plant_")) {
        material = new THREE.MeshStandardMaterial({
          color: 0x3a8a48,
          metalness: 0.05,
          roughness: 0.9,
          emissive: 0x102818,
          emissiveIntensity: 0.12,
        });
      } else {
        const baseTexture = index % 2 === 0 ? wallTextures.wood : wallTextures.brick;
        const texture = baseTexture.clone();
        texture.needsUpdate = true;
        const longAxis = Math.max(box.size.x, box.size.z);
        texture.repeat.set(
          Math.max(1, Math.round(longAxis / WALL_TEXTURE_TILE_SIZE)),
          Math.max(1, Math.round(box.size.y / WALL_TEXTURE_TILE_SIZE)),
        );
        const tint = box.kind === "crate" ? palette.crateTint : palette.wallTint;
        // EPIC 49.3: walls fog-fade at the top into per-map fog (fair shared AABB).
        if (box.kind === "wall") {
          material = createFogFadeWallMaterial(
            texture,
            tint,
            palette.fogColor,
            box.size.y,
          );
        } else {
          material = new THREE.MeshStandardMaterial({ map: texture, color: tint });
        }
      }
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    mesh.name = box.id;
    mapGeometryGroup.add(mesh);
  });
}

function resizeGround(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  groundGeo.dispose();
  groundGeo = new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 8, bounds.maxZ - bounds.minZ + 8);
  ground.geometry = groundGeo;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
}

renderMapGeometry(ARENA_GEOMETRY);

// --- First-person controls (replaces EPIC 1's OrbitControls demo camera) ---
const hud = new CombatHud();
// EPIC 14 "Sound System": one shared procedural audio subsystem for every
// sound in the game. Constructing an AudioContext is safe without a user
// gesture (only STARTING playback needs one) — the actual unlock() call
// happens below, from inside the mode-select click handler (Design
// Decision 6), the first real user gesture in this game.
const soundManager = new SoundManager();
const combatEffects = new CombatEffects(scene);
const killLootVfx = new KillLootVfx(scene);
// EPIC 10 Story 10.1: the viewmodel is attached to the camera (see
// scene.add(camera) above) and reacts to the SAME data already driving the
// HUD — LoadoutMessage.equippedWeapon/ammo (onLoadout below) and the
// existing onFire trigger (below) — no new server message.
const viewmodel = new WeaponViewmodel(camera);
// Tracks this client's own currently-equipped weapon, purely to know which
// weapon's fire feedback (muzzle flash color/size, viewmodel recoil) to
// play on the local onFire trigger below — always kept in sync with the
// server's own LoadoutMessage (onLoadout), never guessed independently.
let currentWeapon: WeaponType = "pistol";
// EPIC 57: local ammo mirror of last LoadoutMessage (null = infinite).
let currentAmmo: number | null = null;
// EPIC 57: last successful local fire (performance.now) for cooldown ring + juice gate.
let lastLocalFireMs = 0;
let selfAlive = true;
// EPIC 41: local spawn-protection gate mirrors HUD (world_state only —
// no free-running timer). While protected, suppress juice + outbound fire.
let selfSpawnProtectedUntilMs = 0;
let lastWorldServerTimeMs = 0;

/** EPIC 57: predictive fire-ready — cosmetic only; server remains authoritative. */
function isLocalFireReady(nowMs: number = performance.now()): boolean {
  if (!selfAlive) return false;
  if (lastWorldServerTimeMs < selfSpawnProtectedUntilMs) return false;
  const stats = WEAPON_STATS[currentWeapon];
  if (!stats.infiniteAmmo && (currentAmmo === null || currentAmmo <= 0)) return false;
  if (nowMs - lastLocalFireMs < stats.cooldownMs) return false;
  return true;
}

const fps = new FpsController(camera, renderer.domElement, {
  onFire: () => {
    const nowMs = performance.now();
    // EPIC 57: no fake juice / no outbound fire when client knows shot cannot happen.
    if (!isLocalFireReady(nowMs)) return;
    lastLocalFireMs = nowMs;
    // Immediate local "juice" — cosmetic only, fired before any server
    // round trip. The actual hit outcome (if any) only ever comes from the
    // server's HitEvent broadcast below (security-baseline.mdc: the client
    // never unilaterally declares a hit).
    hud.showMuzzleFlash(currentWeapon);
    viewmodel.triggerFire(currentWeapon);
    // EPIC 14 Story 14.4: instant, zero-latency local gunshot — remote
    // players'/bots' gunshots are played separately, from the server's
    // FireBroadcastEvent (see onFireBroadcast below), never from this call.
    soundManager.playGunshot(currentWeapon);
    connection.send({ type: "fire" });
  },
  // EPIC 57: hold-to-fire for every weapon at that weapon's cooldown.
  shouldAutoFire: () => lastWorldServerTimeMs >= selfSpawnProtectedUntilMs,
  getAutoFireIntervalMs: () => WEAPON_STATS[currentWeapon].cooldownMs,
  // EPIC 14 Story 14.2: fires exactly once per genuine ground-jump trigger
  // (see fpsController.ts's onJump doc comment) — never for the bunny-hop
  // mid-air boost, which has no sound of its own in this EPIC.
  onJump: () => soundManager.playJumpGrunt(),
});
const remotePlayers = new RemotePlayers(scene);
/**
 * EPIC 14 "Sound System" Story 14.5: proximity gate radius for attributing
 * a pickup-consumed transition to THIS client (see PickupRenderer's
 * onConsumed callback below). Starting point per the spec: the server's
 * own actual consumption radius (PICKUP_RADIUS, shared/src/pickups.ts) plus
 * a buffer covering (a) WorldStateMessage's 20Hz broadcast interval (up to
 * ~50ms of tick lag between the server consuming the pickup and this
 * client's next pickup_state snapshot) and (b) how far the LOCAL player
 * could have moved in that same window at MOVEMENT.maxSpeed (13.3 m/s ->
 * up to ~0.67m). +1.75 was chosen (within the spec's suggested "+1.5 to
 * +2" starting range) as a middle-ground buffer: generous enough that a
 * player who just walked over a pickup right at PICKUP_RADIUS's edge still
 * hears their own pickup sound even after ~50ms of continued movement
 * away from it, while still tight enough that a pickup consumed by
 * another player/bot on the far side of a nearby corridor (this map's
 * pickup points are spaced >=10 units apart even at their closest, see
 * shared/src/pickups.ts PICKUP_SPAWN_POINTS comment) essentially never
 * falls inside this client's gate by accident.
 */
const PICKUP_SOUND_RADIUS = PICKUP_RADIUS + 1.75;
// EPIC 6 Story 6.1/6.2: static pickup meshes, visibility driven purely by
// the server's PickupStateMessage broadcasts (see onPickupState below) —
// this renderer never decides pickup state itself.
const pickupRenderer = new PickupRenderer(scene, {
  // EPIC 14 Story 14.5: best-effort attribution heuristic (Design Decision
  // 3) — a consumed pickup near THIS client's own last-known predicted
  // position (fps.getPosition()) is assumed to be this player's own
  // pickup; one consumed elsewhere on the map stays silent on this client.
  // Not perfectly attributed (two players could both be within the gate
  // radius simultaneously) — accepted per the spec as a "juice" cue with
  // no gameplay-relevant effect either way.
  onConsumed: (point) => {
    const position = fps.getPosition();
    const distance = Math.hypot(position.x - point.position.x, position.z - point.position.z);
    if (distance <= PICKUP_SOUND_RADIUS) {
      soundManager.playPickup(point.category);
    }
  },
});

// EPIC 6 Story 6.2: "E" cycles the equipped weapon. Edge-triggered on
// keydown (event.repeat guards against the OS's own key-repeat firing this
// on every repeat tick while held) and gated on pointer lock, same as fire
// — the actual cycle order/logic is entirely server-decided
// (registry.cycleWeapon(), server/src/playerRegistry.ts); this only ever
// sends a bare intent, never a target weapon (see SwitchWeaponEvent doc
// comment, shared/src/index.ts).
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyE" || event.repeat) return;
  if (shouldIgnoreGameHotkey(event)) return;
  if (!fps.isLocked()) return;
  connection.send({ type: "switch_weapon" });
});

function updateHint(): void {
  hintEl.style.display = fps.isLocked() ? "none" : "flex";
}
document.addEventListener("pointerlockchange", updateHint);
updateHint();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

/**
 * EPIC 46 F-002 QA hook: Playwright can hold a temporary eye/look-at pose so
 * landmark screenshots (building door / car) actually frame the AABB props.
 * Cleared after capture; does not affect server authority.
 */
type QaHoldPose = {
  eye: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
};
(window as unknown as { __cwQaHoldPose?: QaHoldPose | null }).__cwQaHoldPose = null;
(window as unknown as { __cwQaCooldownProgress?: number | null }).__cwQaCooldownProgress = null;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // clamp so a tab-switch pause doesn't cause a huge jump
  fps.update(dt);
  const qaPose = (window as unknown as { __cwQaHoldPose?: QaHoldPose | null }).__cwQaHoldPose;
  if (qaPose) {
    camera.position.set(qaPose.eye.x, qaPose.eye.y, qaPose.eye.z);
    camera.lookAt(qaPose.look.x, qaPose.look.y, qaPose.look.z);
  }
  viewmodel.update(dt);
  // EPIC 57: crosshair cooldown ring — fills as local cooldown recovers.
  {
    const qaCooldown = (window as unknown as { __cwQaCooldownProgress?: number | null })
      .__cwQaCooldownProgress;
    if (typeof qaCooldown === "number") {
      hud.setCooldownProgress(qaCooldown);
    } else {
      const cooldownMs = WEAPON_STATS[currentWeapon].cooldownMs;
      const elapsed = performance.now() - lastLocalFireMs;
      const progress =
        lastLocalFireMs <= 0 || cooldownMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / cooldownMs));
      hud.setCooldownProgress(progress);
    }
  }
  // EPIC 14 Story 14.3: drives the footstep cadence timer — fps.isRunning()
  // already folds in "locked AND alive AND grounded AND actually moving
  // horizontally" (see fpsController.ts), so this single call correctly
  // gates footsteps off while airborne/stationary/dead/unlocked.
  soundManager.update(dt, fps.isRunning());
  remotePlayers.update(dt);
  combatEffects.update(dt);
  killLootVfx.update(dt);
  renderer.render(scene, camera);
}
animate();

// --- WebSocket connection to the game server ---
const wsUrl = import.meta.env.VITE_CUBEWARS_WS_URL ?? "ws://localhost:7777";
statusEl.textContent = t("status.connecting", { url: wsUrl });
statusEl.dataset.state = "connecting";

let selfId: string | null = null;
let joinedEndless = false;

// EPIC 5: kill feed and scoreboard are both driven entirely by server
// broadcasts (KillEvent / ScoreboardMessage) wired below — neither ever
// decides a kill or a score itself. `() => selfId` (not a snapshot) because
// both are constructed before the async "welcome" message resolves this
// client's own id.
const killFeed = new KillFeed(() => selfId);
const scoreboard = new Scoreboard(() => selfId);

// EPIC 9 Story 9.2: the mode-select overlay (client/index.html #modeSelect)
// blocks play until the player picks "Multiplayer" or "vs Bots". The
// callback below is the ONLY place `join` is ever sent, and it also gates
// startInputLoop() (defined below) — so no input/fire/switch_weapon
// message can be sent before this connection has joined a match, matching
// the server's own independent gate (server/src/index.ts join-gating;
// belt-and-suspenders, not a substitute for it — the server never trusts
// the client to behave, per security-baseline.mdc).
//
// EPIC 34: mode-select buttons stay disabled until account auth succeeds
// (session resume / register / login). Nickname join flow is unchanged.
/**
 * EPIC 45 F-001: last lobby inventory/auction bind pool requested by this
 * client. While set, ignore mismatched `economy_profile` pushes (stale race).
 * Cleared on join so match-scoped profiles always apply. Mutations still use
 * server `lobbyEconomyPool` — this filter is display-only.
 */
let lastLobbyBindPool: EconomyPool | null = null;
/** EPIC 47: current match context for pause menu / economy pool / change-map. */
let currentMatchMode: MatchMode | null = null;
let currentMapId: MapId | null = null;
let joinedMatch = false;
/** Pending leave reason so leave_match_ack can rejoin or just show lobby. */
let pendingLeave:
  | null
  | { kind: "lobby" }
  | { kind: "rejoin"; mode: MatchMode; mapId?: MapId } = null;

const modeSelect = new ModeSelect(
  (selection) => {
    // Explicit join payload — always pass mapId for public/bots (EPIC 47 harden).
    const joinPayload =
      selection.mode === "endless"
        ? {
            type: "join" as const,
            mode: selection.mode,
            nickname: selection.nickname,
          }
        : {
            type: "join" as const,
            mode: selection.mode,
            nickname: selection.nickname,
            matchId: selection.matchId,
            mapId: selection.mapId ?? modeSelect.getSelectedMapId() ?? DEFAULT_MAP_ID,
          };
    connection.send(joinPayload);
  },
  (pool) => {
    const nickname = modeSelect.getNickname();
    if (!nickname) return;
    lastLobbyBindPool = pool;
    connection.send({ type: "lobby_bind_nickname", nickname, economyPool: pool });
    inventoryOverlay.setStatus(
      pool === "sandbox" ? t("inv.loading.bots") : t("inv.loading.dm"),
    );
    inventoryOverlay.setOpen(true);
  },
  () => {
    const nickname = modeSelect.getNickname();
    if (!nickname) return;
    lastLobbyBindPool = "deathmatch";
    connection.send({ type: "lobby_bind_nickname", nickname, economyPool: "deathmatch" });
    auctionPanel.setOpen(true);
  },
);

let inventoryOverlay!: InventoryOverlay;
let auctionPanel!: AuctionPanel;
let tradePanel!: TradePanel;
let groundHud!: GroundHud;
let pauseMenu!: PauseMenu;
let devConsole!: DevConsole;
let lastWorldPlayers: WorldStateMessage["players"] = [];
const connection = new GameConnection(wsUrl, {
  onOpen: () => {
    statusEl.textContent = t("status.connectedWaiting");
  },
  onWelcome: (playerId) => {
    selfId = playerId;
    statusEl.textContent = t("status.connectedSignIn");
    statusEl.dataset.state = "connected";
    // EPIC 34: attempt session resume (or show email UI). Mode-select is
    // enabled only after onAuthenticated below.
    accountAuth.onWelcome();
  },
  onAccountCreated: (message) => {
    accountAuth.handleAccountCreated(message);
  },
  onAccountLoginResult: (message) => {
    accountAuth.handleLoginResult(message);
  },
  onAccountSessionResult: (message) => {
    accountAuth.handleSessionResult(message);
  },
  onAccountResetCodeResult: (message) => {
    accountAuth.handleResetCodeResult(message);
  },
  onLobbyState: (message) => {
    modeSelect.setLobby(message.matches);
  },
  onLeaderboard: (message) => {
    modeSelect.setLeaderboard(message.entries);
  },
  onEndlessLeaderboard: (message) => {
    modeSelect.setEndlessLeaderboard(message.entries);
  },
  onMapState: (message) => {
    const endless = joinedEndless || currentMatchMode === "endless";
    if (message.mapId) {
      currentMapId = message.mapId;
      pauseMenu.setMatchContext(currentMatchMode, currentMapId);
      modeSelect.setSelectedMapId(message.mapId);
    }
    // EPIC 49: apply palette before geometry so walls/crates/props tint correctly.
    applyMapTheme(themeIdFromMapState(message.mapId ?? currentMapId, endless), themeScene);
    renderMapGeometry(message.geometry);
    resizeGround(message.bounds);
    fps.setCollisionGeometry(message.geometry);
  },
  onEndlessState: (message) => {
    endlessHudEl.classList.add("visible");
    endlessDistanceEl.textContent = `${(message.distanceMeters / 1000).toFixed(2)} km`;
    endlessKillsEl.textContent = t("hud.endless.bots", { n: message.botKills });
    endlessFogEl.textContent = t("hud.endless.fog", {
      m: Math.max(0, Math.round(Math.abs(message.fogZ))),
    });
    fogWall.visible = joinedEndless;
    fogWall.position.z = message.fogZ;
  },
  onJoinAccepted: (message) => {
    lastLobbyBindPool = null;
    modeSelect.joinAccepted(message.nickname);
    joinedMatch = true;
    currentMatchMode = message.mode ?? (message.matchId.startsWith("endless:") ? "endless" : message.matchId.startsWith("bots:") ? "bots" : "public");
    currentMapId = message.mapId ?? (currentMatchMode === "endless" ? null : DEFAULT_MAP_ID);
    pauseMenu.setMatchContext(currentMatchMode, currentMapId);
    const catalog = currentMapId ? listMaps().find((m) => m.id === currentMapId) : undefined;
    const mapLabel = catalog
      ? localizedMapName(catalog)
      : currentMapId ?? (currentMatchMode === "endless" ? t("pause.mode.endless") : "—");
    statusEl.textContent = t("status.joined", {
      matchId: message.matchId,
      nickname: message.nickname,
      map: mapLabel,
    });
    joinedEndless = message.matchId.startsWith("endless:") || currentMatchMode === "endless";
    endlessHudEl.classList.toggle("visible", joinedEndless);
    fogWall.visible = joinedEndless;
    // Theme may arrive again with map_state; seed endless/default early.
    applyMapTheme(themeIdFromMapState(currentMapId, joinedEndless), themeScene);
    soundManager.unlock();
    startInputLoop();
  },
  onJoinRejected: (message) => {
    modeSelect.joinRejected(message.reason);
    pendingLeave = null;
  },
  onLeaveMatchAck: () => {
    const pending = pendingLeave;
    pendingLeave = null;
    // EPIC 48: skip Base geometry reset when immediately rejoining another map.
    clearMatchClientState({ resetGeometryToBase: pending?.kind !== "rejoin" });
    if (pending?.kind === "rejoin") {
      const nickname = modeSelect.getNickname();
      if (!nickname) {
        modeSelect.showLobby();
        return;
      }
      if (pending.mode === "endless") {
        connection.send({ type: "join", mode: "endless", nickname });
      } else {
        if (pending.mapId) modeSelect.setSelectedMapId(pending.mapId);
        connection.send({
          type: "join",
          mode: pending.mode,
          nickname,
          mapId: pending.mapId ?? modeSelect.getSelectedMapId() ?? DEFAULT_MAP_ID,
        });
      }
      return;
    }
    modeSelect.showLobby();
    statusEl.textContent = t("status.backInLobby");
  },
  onWorldState: (message: WorldStateMessage) => {
    lastWorldPlayers = message.players;
    remotePlayers.sync(message.players, selfId, message.serverTimeMs);
    if (selfId) {
      const self = message.players.find((p) => p.id === selfId);
      if (self) {
        groundHud.setSelfPosition(self.position);
        fps.reconcile(self.position);
        // Health/alive are the continuous source of truth (server-computed
        // every tick) — HUD and local movement/fire gating are driven from
        // here every world_state, not only from the one-off hit/death/
        // respawn events below, so a missed event still self-corrects on
        // the next tick.
        fps.setAlive(self.alive);
        selfAlive = self.alive;
        // EPIC 55: HUD current/max from server fields only — never invent
        // max from local pet ratings. Fallback to COMBAT constants only if
        // an older payload omits the additive fields.
        hud.setHealth(self.health, self.maxHealth ?? COMBAT.maxHealth);
        hud.setArmor(self.armor, self.maxArmor ?? COMBAT.maxArmor);
        // EPIC 36: spawn-protection cue from broadcast deadline vs this
        // tick's serverTimeMs only (no local free-running countdown).
        // EPIC 41: same values gate local fire prediction / outbound "fire".
        selfSpawnProtectedUntilMs = self.spawnProtectedUntilMs;
        lastWorldServerTimeMs = message.serverTimeMs;
        const protectRemaining = self.spawnProtectedUntilMs - message.serverTimeMs;
        hud.setSpawnProtection(protectRemaining > 0 ? protectRemaining : null);
        hud.setDead(!self.alive);
        if (self.avatarColors) {
          inventoryOverlay.setAvatarColors(self.avatarColors);
        }
      }
    }
  },
  onHit: (message) => {
    if (message.shooterId === selfId) hud.showHitMarker();
    combatEffects.spawnHit(message.point, message.hitZone);
    if (message.targetId === selfId) {
      hud.showDamageFlash();
      // EPIC 14 Story 14.6: synchronized with the existing damage-flash
      // visual pulse — only for a confirmed hit on THIS client, never for
      // the hit-marker branch above (landing a hit on someone else stays
      // independent, same discipline as the visual feedback already has).
      soundManager.playHitTaken();
    }
  },
  onDeath: (message) => {
    if (message.playerId === selfId) hud.setDead(true);
  },
  onRespawn: (message) => {
    if (message.playerId === selfId) hud.setDead(false);
  },
  onKill: (message) => {
    killFeed.addKill(message.attackerId, message.victimId, message.attackerNickname, message.victimNickname);
  },
  onScoreboard: (message) => {
    scoreboard.update(message.players);
  },
  onLoadout: (message) => {
    // EPIC 6: this client's own equipped weapon + ammo, entirely
    // server-decided (LoadoutMessage is private to this connection, see
    // server/src/index.ts sendLoadout()) — the HUD only ever renders it.
    const stats = WEAPON_STATS[message.equippedWeapon];
    hud.setWeapon(stats.displayName, stats.color, message.ammo);
    // EPIC 10 Story 10.1: the viewmodel reacts to this SAME message — no new
    // server message, per the spec. currentWeapon is also the source used by
    // the onFire callback above to pick the right fire feedback.
    currentWeapon = message.equippedWeapon;
    currentAmmo = message.ammo;
    viewmodel.setWeapon(message.equippedWeapon);
    viewmodel.setEmpty(message.ammo === 0);
  },
  onEconomyProfile: (message) => {
    // EPIC 45 F-001: drop stale other-pool profiles after a newer lobby bind.
    if (lastLobbyBindPool !== null && message.economyPool !== lastLobbyBindPool) {
      return;
    }
    hud.setGold(message.gold);
    hud.setRatings(message.ratings);
    modeSelect.setGold(message.gold);
    inventoryOverlay.setProfile(message);
    auctionPanel.setProfile(message);
  },
  onEconomyGoldUpdate: (message) => {
    hud.setGold(message.gold);
    modeSelect.setGold(message.gold);
  },
  onEconomyKillLootFx: (message) => {
    // EPIC 44: render only server-listed grant kinds — never invent drops.
    killLootVfx.spawnFromMessage(message);
  },
  onEconomyActionResult: (message) => {
    inventoryOverlay.setActionResult(message);
  },
  onEconomyAuctionState: (message) => {
    auctionPanel.setAuctionState(message);
  },
  onEconomyGroundState: (message) => {
    groundHud.setGroundState(message);
  },
  onEconomyTradeState: (message) => {
    tradePanel.setTradeState(message);
  },
  onDevConsoleResult: (message) => {
    devConsole.appendResult(message.ok, message.message);
  },
  onPickupState: (message) => {
    pickupRenderer.sync(message.pickups);
  },
  // EPIC 14 Story 14.4: a remote player's/bot's fire attempt (hit, miss, or
  // dry alike — see FireBroadcastEvent doc comment, shared/src/index.ts).
  // Only played when it's NOT this client's own shot — the local player's
  // own gunshot is already played instantly, at zero latency, via the
  // onFire callback above; echoing the server broadcast back to the
  // shooter too would double-play it.
  onFireBroadcast: (message) => {
    if (message.trace) {
      combatEffects.spawnShot(message.weapon, message.trace, message.projectileId);
    }
    if (message.shooterId !== selfId) {
      soundManager.playGunshot(message.weapon);
    }
  },
  onProjectileImpact: (message) => {
    combatEffects.impactProjectile(message.projectileId, message.point);
  },
  onClose: () => {
    statusEl.textContent = t("status.disconnected");
    statusEl.dataset.state = "disconnected";
  },
  onError: (err) => {
    console.error("[client] websocket error", err);
    statusEl.textContent = t("status.connectionError");
    statusEl.dataset.state = "error";
  },
});

// EPIC 34: lobby email/code auth — gates mode-select until authenticated.
const accountAuth = new AccountAuth(
  (message) => {
    if (message.type === "account_register" && message.email) {
      connection.send({ type: "account_register", email: message.email });
    } else if (message.type === "account_login" && message.email && message.code) {
      connection.send({ type: "account_login", email: message.email, code: message.code });
    } else if (message.type === "account_session_resume" && message.token) {
      connection.send({ type: "account_session_resume", token: message.token });
    } else if (message.type === "account_reset_code" && message.email) {
      connection.send({ type: "account_reset_code", email: message.email });
    }
  },
  {
    onAuthenticated: ({ email }) => {
      statusEl.textContent = t("status.signedInChooseNick", { email });
      modeSelect.enable();
    },
  },
);

// EPIC 29: I opens/closes the inventory overlay; P keeps working as an alias
// (see InventoryOverlay's own keydown listener) — the overlay owns its own
// key handling the same way ModeSelect/Scoreboard own theirs, not main.ts.
inventoryOverlay = new InventoryOverlay((message) => connection.send(message));
auctionPanel = new AuctionPanel((message) => connection.send(message));
tradePanel = new TradePanel((message) => connection.send(message));
groundHud = new GroundHud((message) => connection.send(message));
devConsole = new DevConsole((command) => connection.send({ type: "dev_console", command }));

window.addEventListener(
  "keydown",
  (event) => {
    devConsole.handleKeyDown(event, {
      joinedMatch,
      pauseMenuOpen: isPauseMenuVisible(),
    });
  },
  true,
);

function clearMatchClientState(opts: { resetGeometryToBase?: boolean } = {}): void {
  joinedMatch = false;
  currentMatchMode = null;
  currentMapId = null;
  joinedEndless = false;
  endlessHudEl.classList.remove("visible");
  fogWall.visible = false;
  remotePlayers.sync([], selfId, Date.now());
  pickupRenderer.sync([]);
  pauseMenu.setMatchContext(null, null);
  pauseMenu.setOpen(false);
  devConsole.setOpen(false);
  inventoryOverlay.setOpen(false);
  auctionPanel.setOpen(false);
  if (document.pointerLockElement) document.exitPointerLock();
  // EPIC 48: on leave→rejoin (change map), do NOT paint Base defaults —
  // that flash made every map change look like "Base always loads" until
  // map_state arrived (and looked stuck if map_state was slow/missed).
  if (opts.resetGeometryToBase !== false) {
    // EPIC 49: reset desert Base atmosphere so Crystal Cave fog does not bleed into lobby.
    applyMapTheme("lobby", themeScene);
    renderMapGeometry(ARENA_GEOMETRY);
    resizeGround(ARENA_BOUNDS);
    fps.setCollisionGeometry(ARENA_GEOMETRY);
  }
}

function economyPoolForMode(mode: MatchMode | null): EconomyPool {
  return mode === "public" ? "deathmatch" : "sandbox";
}

function requestLeave(next: typeof pendingLeave): void {
  if (!joinedMatch) {
    pendingLeave = next;
    // Already out — treat as immediate ack path.
    clearMatchClientState();
    modeSelect.showLobby();
    return;
  }
  pendingLeave = next;
  pauseMenu.setStatus(t("status.leavingMatch"));
  connection.send({ type: "leave_match" });
}

pauseMenu = new PauseMenu((action) => {
  switch (action.type) {
    case "resume":
      pauseMenu.setOpen(false);
      break;
    case "exit_lobby":
      requestLeave({ kind: "lobby" });
      break;
    case "change_map": {
      modeSelect.setSelectedMapId(action.mapId);
      const mode = currentMatchMode === "endless" ? "bots" : currentMatchMode ?? "bots";
      requestLeave({ kind: "rejoin", mode, mapId: action.mapId });
      break;
    }
    case "reload_endless":
      requestLeave({ kind: "rejoin", mode: "endless" });
      break;
    case "inventory": {
      pauseMenu.setOpen(false);
      const pool = economyPoolForMode(currentMatchMode);
      const nickname = modeSelect.getNickname();
      if (!nickname) break;
      // In-match: profile already pushed for the match pool; still bind when
      // opening so lobby-style pool filter stays consistent after leave.
      if (!joinedMatch) {
        lastLobbyBindPool = pool;
        connection.send({ type: "lobby_bind_nickname", nickname, economyPool: pool });
      }
      inventoryOverlay.setStatus(
        pool === "sandbox" ? t("inv.bound.bots") : t("inv.bound.dm"),
      );
      inventoryOverlay.setOpen(true);
      break;
    }
    case "auction": {
      // Pause is in-match only. Open auction without lobby bind /
      // lastLobbyBindPool — same as U-key. Binding here would set the
      // EPIC 45 filter to deathmatch and drop sandbox economy_profile for
      // the rest of bots/endless (EPIC 47 Critic F-001). Lobby Auction on
      // mode-select still binds Deathmatch pool unchanged.
      pauseMenu.setOpen(false);
      auctionPanel.setOpen(true);
      break;
    }
  }
});

// EPIC 38: T opens trade with the nearest other alive human in the match.
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyT" || event.repeat) return;
  if (shouldIgnoreGameHotkey(event)) return;
  if (!selfId) return;
  const self = lastWorldPlayers.find((p) => p.id === selfId);
  if (!self) return;
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const p of lastWorldPlayers) {
    if (p.id === selfId || !p.alive) continue;
    const dx = p.position.x - self.position.x;
    const dz = p.position.z - self.position.z;
    const d = Math.hypot(dx, dz);
    if (d < bestDist) {
      bestDist = d;
      bestId = p.id;
    }
  }
  if (!bestId || bestDist > 8) return;
  event.preventDefault();
  tradePanel.openWith(bestId);
});

// Send input intent on a fixed interval, independent of render frame rate.
// ~30Hz (33ms) is responsive without flooding the server; the server's own
// broadcast tick is 20Hz (see server/src/match.ts). This is intent only —
// the server computes and broadcasts the actual authoritative position.
const INPUT_SEND_INTERVAL_MS = 33;
let inputLoopStarted = false;
/**
 * Start sending PlayerInputMessage on the fixed interval above — called
 * exactly once, from modeSelect's onSelect callback right after `join` is
 * sent (EPIC 9 Story 9.2). Before that, this client never sends `input` at
 * all: there is nothing useful to send (no match to move around in yet),
 * and it avoids spamming the server's pre-join gameplay-message rejection
 * path (server/src/index.ts notJoinedDropTracker) with an entire session's
 * worth of pre-join traffic every 33ms.
 */
function startInputLoop(): void {
  if (inputLoopStarted) return;
  inputLoopStarted = true;
  setInterval(() => {
    // Pre-join: never spam input (server rejects until join).
    if (!joinedMatch) return;
    if (isLobbyVisible() || isPauseMenuVisible()) {
      const intent = fps.getInputIntent();
      const message: PlayerInputMessage = {
        type: "input",
        moveForward: 0,
        moveRight: 0,
        yaw: intent.yaw,
        pitch: intent.pitch,
        jump: false,
      };
      connection.send(message);
      return;
    }
    const intent = fps.getInputIntent();
    const message: PlayerInputMessage = { type: "input", ...intent };
    connection.send(message);
  }, INPUT_SEND_INTERVAL_MS);
}
