import * as THREE from "three";
import {
  ARENA_BOUNDS,
  ARENA_GEOMETRY,
  WEAPON_STATS,
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
import { WeaponViewmodel } from "./viewmodel";
import { buildSkyDome, buildWallTextures } from "./textures";

const statusEl = document.getElementById("status") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;

// --- Scene: sandy/tan de_dust-inspired arena (EPIC 3), gradient sky (EPIC 10) ---
// EPIC 10 Story 10.2: a warm tone matching the gradient sky dome's horizon
// color (client/src/textures.ts buildSkyDome()) so distant fogged geometry
// blends into the new sky instead of clashing with it — replaces the flat
// SKY_COLOR fill/fog this used to share with a plain `scene.background` color.
const FOG_COLOR = 0xf3d9a8;
const scene = new THREE.Scene();
// Arena spans roughly 92x52 units — fog range widened from EPIC 1/2's flat
// field so the far site is still visible across mid/tunnel sightlines.
scene.fog = new THREE.Fog(FOG_COLOR, 40, 170);
scene.add(buildSkyDome());

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
const groundGeo = new THREE.PlaneGeometry(groundWidth, groundDepth);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xe3c98c }); // sandy tan
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Arena geometry: render every wall/crate from the shared, server-matching
// AABB list (EPIC 3 Story 3.2) — this is the ONE layout definition, also used
// for collision in fpsController.ts and server/src/playerRegistry.ts.
//
// EPIC 10 Story 10.2: replaces the old flat sandstone/wood-crate colors with
// two procedurally-generated CanvasTextures (wood/brick, built ONCE here at
// scene setup — see client/src/textures.ts doc comment on why this must
// never happen inside the render loop), alternated by index so walls/crates
// show real variety rather than one texture applied uniformly. Purely a
// materials change — geometry/positions (and thus collision, which reads
// ARENA_GEOMETRY independently) are untouched. ---
const WALL_TEXTURE_TILE_SIZE = 2; // world units per texture tile, both wood & brick
const wallTextures = buildWallTextures();
ARENA_GEOMETRY.forEach((box, index) => {
  const baseTexture = index % 2 === 0 ? wallTextures.wood : wallTextures.brick;
  // Each box gets its own texture instance (repeat differs per box size) —
  // cheap, still generated from the same one canvas-drawn image, not a
  // second draw call.
  const texture = baseTexture.clone();
  texture.needsUpdate = true;
  const longAxis = Math.max(box.size.x, box.size.z);
  texture.repeat.set(
    Math.max(1, Math.round(longAxis / WALL_TEXTURE_TILE_SIZE)),
    Math.max(1, Math.round(box.size.y / WALL_TEXTURE_TILE_SIZE)),
  );

  const geometry = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  mesh.name = box.id;
  scene.add(mesh);
});

// --- First-person controls (replaces EPIC 1's OrbitControls demo camera) ---
const hud = new CombatHud();
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
const fps = new FpsController(camera, renderer.domElement, {
  onFire: () => {
    // Immediate local "juice" — cosmetic only, fired before any server
    // round trip. The actual hit outcome (if any) only ever comes from the
    // server's HitEvent broadcast below (security-baseline.mdc: the client
    // never unilaterally declares a hit).
    hud.showMuzzleFlash(currentWeapon);
    viewmodel.triggerFire(currentWeapon);
    connection.send({ type: "fire" });
  },
});
const remotePlayers = new RemotePlayers(scene);
// EPIC 6 Story 6.1/6.2: static pickup meshes, visibility driven purely by
// the server's PickupStateMessage broadcasts (see onPickupState below) —
// this renderer never decides pickup state itself.
const pickupRenderer = new PickupRenderer(scene);

// EPIC 6 Story 6.2: "E" cycles the equipped weapon. Edge-triggered on
// keydown (event.repeat guards against the OS's own key-repeat firing this
// on every repeat tick while held) and gated on pointer lock, same as fire
// — the actual cycle order/logic is entirely server-decided
// (registry.cycleWeapon(), server/src/playerRegistry.ts); this only ever
// sends a bare intent, never a target weapon (see SwitchWeaponEvent doc
// comment, shared/src/index.ts).
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyE" || event.repeat) return;
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
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // clamp so a tab-switch pause doesn't cause a huge jump
  fps.update(dt);
  viewmodel.update(dt);
  renderer.render(scene, camera);
}
animate();

// --- WebSocket connection to the game server ---
const wsUrl = import.meta.env.VITE_CUBEWARS_WS_URL ?? "ws://localhost:7777";
statusEl.textContent = `connecting to ${wsUrl}…`;
statusEl.dataset.state = "connecting";

let selfId: string | null = null;

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
const modeSelect = new ModeSelect((mode: MatchMode) => {
  connection.send({ type: "join", mode });
  startInputLoop();
});

const connection = new GameConnection(wsUrl, {
  onOpen: () => {
    statusEl.textContent = "connected (waiting for welcome)";
  },
  onWelcome: (playerId) => {
    selfId = playerId;
    statusEl.textContent = `connected — player ${playerId.slice(0, 8)}`;
    statusEl.dataset.state = "connected";
    // EPIC 9 Story 9.2: only now is it safe to let the player pick a mode —
    // GameConnection.send() silently drops anything sent before the socket
    // is OPEN, and "welcome" is the server's confirmation this connection is
    // live and has an id.
    modeSelect.enable();
  },
  onWorldState: (message: WorldStateMessage) => {
    remotePlayers.sync(message.players, selfId);
    if (selfId) {
      const self = message.players.find((p) => p.id === selfId);
      if (self) {
        fps.reconcile(self.position);
        // Health/alive are the continuous source of truth (server-computed
        // every tick) — HUD and local movement/fire gating are driven from
        // here every world_state, not only from the one-off hit/death/
        // respawn events below, so a missed event still self-corrects on
        // the next tick.
        fps.setAlive(self.alive);
        hud.setHealth(self.health);
        // EPIC 7: armor is the same "continuous source of truth every tick"
        // pattern as health above — see PlayerState.armor doc comment
        // (shared/src/index.ts).
        hud.setArmor(self.armor);
        hud.setDead(!self.alive);
      }
    }
  },
  onHit: (message) => {
    if (message.shooterId === selfId) hud.showHitMarker();
    if (message.targetId === selfId) hud.showDamageFlash();
  },
  onDeath: (message) => {
    if (message.playerId === selfId) hud.setDead(true);
  },
  onRespawn: (message) => {
    if (message.playerId === selfId) hud.setDead(false);
  },
  onKill: (message) => {
    killFeed.addKill(message.attackerId, message.victimId);
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
    viewmodel.setWeapon(message.equippedWeapon);
    viewmodel.setEmpty(message.ammo === 0);
  },
  onPickupState: (message) => {
    pickupRenderer.sync(message.pickups);
  },
  onClose: () => {
    statusEl.textContent = "disconnected";
    statusEl.dataset.state = "disconnected";
  },
  onError: (err) => {
    console.error("[client] websocket error", err);
    statusEl.textContent = "connection error";
    statusEl.dataset.state = "error";
  },
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
    const intent = fps.getInputIntent();
    const message: PlayerInputMessage = { type: "input", ...intent };
    connection.send(message);
  }, INPUT_SEND_INTERVAL_MS);
}
