// Procedurally-generated wall materials + sky (EPIC 10 Story 10.2). Both
// textures are drawn once via the browser's 2D Canvas API into a
// THREE.CanvasTexture — no external asset files/pipeline, staying inside
// the fixed stack (EPIC 10 spec "Stack" field). Generation happens exactly
// once at module load / scene-setup time, never inside the render loop
// (EPIC 10 spec Risks: a naive per-frame redraw would be a real, if subtle,
// performance regression — Critic is specifically asked to check this).

import * as THREE from "three";

const CANVAS_SIZE = 256;

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable — cannot generate procedural textures");
  return { canvas, ctx };
}

/** Warm-brown wood-plank texture: horizontal planks with grain lines and seams. */
function drawWoodTexture(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const plankHeight = CANVAS_SIZE / 6;
  const plankColors = ["#96612f", "#8b5a2b", "#7d5027", "#8f5d2e"];
  for (let row = 0; row < 6; row++) {
    const y = row * plankHeight;
    ctx.fillStyle = plankColors[row % plankColors.length];
    ctx.fillRect(0, y, CANVAS_SIZE, plankHeight);

    // Plank seam (horizontal divider).
    ctx.strokeStyle = "rgba(40, 24, 10, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_SIZE, y);
    ctx.stroke();

    // A handful of grain lines per plank, slightly wavy.
    ctx.strokeStyle = "rgba(60, 36, 14, 0.35)";
    ctx.lineWidth = 1;
    for (let g = 0; g < 4; g++) {
      const gy = y + ((g + 1) * plankHeight) / 5 + (Math.sin(row * 3.1 + g) * plankHeight) / 10;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= CANVAS_SIZE; x += 16) {
        ctx.lineTo(x, gy + Math.sin((x / CANVAS_SIZE) * Math.PI * 4 + g) * 2);
      }
      ctx.stroke();
    }
  }
}

/** Reddish brick texture: staggered brick rows with mortar lines. */
function drawBrickTexture(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#8f9a9a"; // mortar base
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const brickHeight = CANVAS_SIZE / 8;
  const brickWidth = CANVAS_SIZE / 4;
  const mortar = 4;
  const brickColors = ["#a34a3a", "#9c4535", "#ab5040", "#96412f"];

  for (let row = 0; row < 8; row++) {
    const y = row * brickHeight;
    const offset = row % 2 === 0 ? 0 : -brickWidth / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * brickWidth + offset;
      ctx.fillStyle = brickColors[(row + col + 4) % brickColors.length];
      ctx.fillRect(x + mortar / 2, y + mortar / 2, brickWidth - mortar, brickHeight - mortar);
    }
  }
}

export interface WallTextures {
  wood: THREE.CanvasTexture;
  brick: THREE.CanvasTexture;
}

/**
 * Build the wood + brick CanvasTextures once. Callers set `.repeat` per-box
 * (scaled to that box's real dimensions from ARENA_GEOMETRY) before use —
 * `wrapS`/`wrapT` are already set to RepeatWrapping here.
 */
export function buildWallTextures(): WallTextures {
  const wood = makeCanvas();
  drawWoodTexture(wood.ctx);
  const woodTexture = new THREE.CanvasTexture(wood.canvas);
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.colorSpace = THREE.SRGBColorSpace;

  const brick = makeCanvas();
  drawBrickTexture(brick.ctx);
  const brickTexture = new THREE.CanvasTexture(brick.canvas);
  brickTexture.wrapS = THREE.RepeatWrapping;
  brickTexture.wrapT = THREE.RepeatWrapping;
  brickTexture.colorSpace = THREE.SRGBColorSpace;

  return { wood: woodTexture, brick: brickTexture };
}

/**
 * Large inverted sphere with a vertex-colored vertical gradient (lighter
 * blue at the top, warmer tone near the horizon) — the standard cheap
 * Three.js "gradient sky" technique, replacing the previous flat
 * `scene.background` color fill (EPIC 10 Story 10.2).
 */
export function buildSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(480, 24, 16);
  const topColor = new THREE.Color(0x6fb2e8); // lighter blue, zenith
  const horizonColor = new THREE.Color(0xf3d9a8); // warm tone near the horizon

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    // y ranges over [-radius, radius]; map to [0,1] and bias so the warm
    // horizon band is concentrated near y=0 rather than spread evenly.
    const t = THREE.MathUtils.clamp(y / 480, -1, 1);
    const horizonBlend = 1 - Math.pow(Math.abs(t), 0.45);
    color.copy(horizonColor).lerp(topColor, 1 - horizonBlend);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sky_dome";
  return mesh;
}
