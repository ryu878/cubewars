import * as THREE from "three";
import {
  ARENA_BOUNDS,
  ARENA_GEOMETRY,
  WEAPON_STATS,
  type PlayerInputMessage,
  type WorldStateMessage,
} from "@cubewars/shared";
import { GameConnection } from "./network";
import { FpsController } from "./fpsController";
import { RemotePlayers } from "./remotePlayers";
import { CombatHud } from "./combatHud";
import { KillFeed } from "./killFeed";
import { Scoreboard } from "./scoreboard";
import { PickupRenderer } from "./pickups";

const statusEl = document.getElementById("status") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;

// --- Scene: sandy/tan de_dust-inspired arena (EPIC 3) ---
const SKY_COLOR = 0xbfd8e8;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
// Arena spans roughly 92x52 units — fog range widened from EPIC 1/2's flat
// field so the far site is still visible across mid/tunnel sightlines.
scene.fog = new THREE.Fog(SKY_COLOR, 40, 170);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

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
// for collision in fpsController.ts and server/src/playerRegistry.ts. ---
const wallMat = new THREE.MeshStandardMaterial({ color: 0xb08d57 }); // sandstone
const crateMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b }); // wood crate
for (const box of ARENA_GEOMETRY) {
  const geometry = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z);
  const material = box.kind === "wall" ? wallMat : crateMat;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  mesh.name = box.id;
  scene.add(mesh);
}

// --- First-person controls (replaces EPIC 1's OrbitControls demo camera) ---
const hud = new CombatHud();
const fps = new FpsController(camera, renderer.domElement, {
  onFire: () => {
    // Immediate local "juice" — cosmetic only, fired before any server
    // round trip. The actual hit outcome (if any) only ever comes from the
    // server's HitEvent broadcast below (security-baseline.mdc: the client
    // never unilaterally declares a hit).
    hud.showMuzzleFlash();
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

const connection = new GameConnection(wsUrl, {
  onOpen: () => {
    statusEl.textContent = "connected (waiting for welcome)";
  },
  onWelcome: (playerId) => {
    selfId = playerId;
    statusEl.textContent = `connected — player ${playerId.slice(0, 8)}`;
    statusEl.dataset.state = "connected";
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
// broadcast tick is 20Hz (see server/src/index.ts). This is intent only —
// the server computes and broadcasts the actual authoritative position.
const INPUT_SEND_INTERVAL_MS = 33;
setInterval(() => {
  const intent = fps.getInputIntent();
  const message: PlayerInputMessage = { type: "input", ...intent };
  connection.send(message);
}, INPUT_SEND_INTERVAL_MS);
