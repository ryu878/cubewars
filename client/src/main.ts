import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ServerMessage } from "@cubewars/shared";

const statusEl = document.getElementById("status") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky blue
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(6, 5, 10);

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

// --- Placeholder player avatar ---
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe63946 });
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.5, 1.2, 4, 8),
  bodyMat,
);
body.position.y = 1.1;
scene.add(body);

// --- Camera controls (drag to look around) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3;
controls.maxDistance = 40;
controls.update();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- WebSocket connection to the game server ---
const wsUrl = import.meta.env.VITE_CUBEWARS_WS_URL ?? "ws://localhost:7777";
statusEl.textContent = `connecting to ${wsUrl}…`;
statusEl.dataset.state = "connecting";

const socket = new WebSocket(wsUrl);

socket.addEventListener("open", () => {
  statusEl.textContent = "connected (waiting for welcome)";
});

socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === "welcome") {
      statusEl.textContent = `connected — player ${message.playerId.slice(0, 8)}`;
      statusEl.dataset.state = "connected";
    }
  } catch (err) {
    console.error("[client] failed to parse server message", err);
  }
});

socket.addEventListener("close", () => {
  statusEl.textContent = "disconnected";
  statusEl.dataset.state = "disconnected";
});

socket.addEventListener("error", (err) => {
  console.error("[client] websocket error", err);
  statusEl.textContent = "connection error";
  statusEl.dataset.state = "error";
});
