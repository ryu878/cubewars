import * as THREE from "three";
import type { PlayerInputMessage, WorldStateMessage } from "@cubewars/shared";
import { GameConnection } from "./network";
import { FpsController } from "./fpsController";
import { RemotePlayers } from "./remotePlayers";

const statusEl = document.getElementById("status") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;

// --- Scene (unchanged from EPIC 1 — ground/blocks/sky are EPIC 3/4's job) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky blue
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

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

// --- Lighting (avoid the flat/grey default-Three.js look) ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a6e3a, 0.9);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(20, 30, 10);
scene.add(sunLight);

// --- Ground ---
const groundGeo = new THREE.PlaneGeometry(80, 80);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x4caf50 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Scattered colorful blocks (low-poly, Roblox-ish blockiness) ---
const blockMatA = new THREE.MeshStandardMaterial({ color: 0xffb703 });
const blockMatB = new THREE.MeshStandardMaterial({ color: 0x219ebc });
for (let i = 0; i < 8; i++) {
  const size = 1.5 + Math.random() * 1.5;
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    i % 2 === 0 ? blockMatA : blockMatB,
  );
  block.position.set(
    (Math.random() - 0.5) * 40,
    size / 2,
    (Math.random() - 0.5) * 40,
  );
  scene.add(block);
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
