import * as THREE from "three";
import { ARENA_BOUNDS, ARENA_GEOMETRY, type PlayerInputMessage, type WorldStateMessage } from "@cubewars/shared";
import { GameConnection } from "./network";
import { FpsController } from "./fpsController";
import { RemotePlayers } from "./remotePlayers";

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
const fps = new FpsController(camera, renderer.domElement);
const remotePlayers = new RemotePlayers(scene);

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
      if (self) fps.reconcile(self.position);
    }
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
