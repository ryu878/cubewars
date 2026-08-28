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

/** EPIC 58: procedural floor themes — one canvas texture per map id. */
export type GroundThemeId =
  | "base"
  | "rust_canyon"
  | "glass_dome"
  | "dead_station"
  | "fuel_depot"
  | "crystal_cave"
  | "abyss_bridge"
  | "elite_quarter"
  | "endless"
  | "lobby";

function canvasTextureFromDraw(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const { ctx } = makeCanvas();
  draw(ctx, CANVAS_SIZE);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawSandGrid(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#d4b87a";
  ctx.fillRect(0, 0, size, size);
  const tile = size / 8;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const shade = (row + col) % 2 === 0 ? "#c9a96a" : "#dcc890";
      ctx.fillStyle = shade;
      ctx.fillRect(col * tile + 1, row * tile + 1, tile - 2, tile - 2);
    }
  }
  ctx.strokeStyle = "rgba(90, 70, 40, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * tile, 0);
    ctx.lineTo(i * tile, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * tile);
    ctx.lineTo(size, i * tile);
    ctx.stroke();
  }
}

function drawCrackedRust(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#8a5030";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(${80 + Math.random() * 40}, ${40 + Math.random() * 30}, ${20 + Math.random() * 20}, 0.25)`;
    ctx.fillRect(x, y, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  ctx.strokeStyle = "rgba(40, 20, 10, 0.5)";
  ctx.lineWidth = 1;
  for (let c = 0; c < 18; c++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * 28;
      y += (Math.random() - 0.5) * 28;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawMossyTiles(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#8a9a88";
  ctx.fillRect(0, 0, size, size);
  const tile = size / 6;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      ctx.fillStyle = row % 2 === col % 2 ? "#95a890" : "#7a8a78";
      ctx.fillRect(col * tile + 2, row * tile + 2, tile - 4, tile - 4);
      if ((row + col) % 3 === 0) {
        ctx.fillStyle = "rgba(40, 90, 50, 0.35)";
        ctx.beginPath();
        ctx.arc(col * tile + tile / 2, row * tile + tile / 2, tile * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawConcreteHangar(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#6a6e72";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const g = 90 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${g}, ${g}, ${g + 4}, 0.15)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1);
  }
  ctx.strokeStyle = "rgba(30, 32, 36, 0.4)";
  ctx.lineWidth = 2;
  const slab = size / 4;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * slab, 0);
    ctx.lineTo(i * slab, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * slab);
    ctx.lineTo(size, i * slab);
    ctx.stroke();
  }
}

function drawStainedAsphalt(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#4a4844";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(${20 + Math.random() * 20}, ${15 + Math.random() * 15}, ${10 + Math.random() * 10}, 0.45)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 20 + Math.random() * 30, 12 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255, 220, 120, 0.12)";
  ctx.lineWidth = 1;
  for (let l = 0; l < 6; l++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * size, 0);
    ctx.lineTo(Math.random() * size, size);
    ctx.stroke();
  }
}

function drawDarkRockGlow(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#2a2838";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 200; i++) {
    const g = 35 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgba(${g}, ${g}, ${g + 15}, 0.2)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 2);
  }
  ctx.strokeStyle = "rgba(80, 160, 255, 0.35)";
  ctx.lineWidth = 1.5;
  for (let v = 0; v < 10; v++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.3) * 40;
      y += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawMetalGrate(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#505860";
  ctx.fillRect(0, 0, size, size);
  const gap = size / 16;
  ctx.strokeStyle = "#707880";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 16; i++) {
    ctx.beginPath();
    ctx.moveTo(i * gap, 0);
    ctx.lineTo(i * gap, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * gap);
    ctx.lineTo(size, i * gap);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(10, 14, 20, 0.55)";
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillRect(col * gap + 2, row * gap + 2, gap - 4, gap - 4);
      }
    }
  }
}

function drawUrbanPavement(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#a89888";
  ctx.fillRect(0, 0, size, size);
  const tile = size / 5;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#b8a898" : "#988878";
      ctx.fillRect(col * tile + 1, row * tile + 1, tile - 2, tile - 2);
    }
  }
  ctx.strokeStyle = "rgba(50, 45, 40, 0.45)";
  ctx.lineWidth = 1;
  for (let c = 0; c < 12; c++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += (Math.random() - 0.5) * 35;
      y += (Math.random() - 0.5) * 35;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const GROUND_DRAWERS: Record<GroundThemeId, (ctx: CanvasRenderingContext2D, size: number) => void> = {
  base: drawSandGrid,
  lobby: drawSandGrid,
  endless: drawSandGrid,
  rust_canyon: drawCrackedRust,
  glass_dome: drawMossyTiles,
  dead_station: drawConcreteHangar,
  fuel_depot: drawStainedAsphalt,
  crystal_cave: drawDarkRockGlow,
  abyss_bridge: drawMetalGrate,
  elite_quarter: drawUrbanPavement,
};

/** Build one procedural ground texture for the given map theme. Caller disposes on swap. */
export function buildGroundTexture(themeId: GroundThemeId): THREE.CanvasTexture {
  const draw = GROUND_DRAWERS[themeId] ?? drawSandGrid;
  return canvasTextureFromDraw(draw);
}

/** All catalog map ids have a ground texture builder (regression helper). */
export function groundThemeIdsForRegression(): GroundThemeId[] {
  return [
    "base",
    "rust_canyon",
    "glass_dome",
    "dead_station",
    "fuel_depot",
    "crystal_cave",
    "abyss_bridge",
    "elite_quarter",
  ];
}

/**
 * EPIC 49 Story 49.3: wall materials whose tops dissolve into the active map
 * fog color. Uses local-Y fade (reliable for BoxGeometry) — albedo → fog +
 * soft alpha at the tip. Collision stays the shared AABB; no mesh above it.
 */
export const WALL_FOG_FADE_START = 0.55;

export function createFogFadeWallMaterial(
  map: THREE.Texture,
  tintHex: number,
  fogHex: number,
  wallHeight: number,
): THREE.MeshStandardMaterial {
  const fogColor = new THREE.Color(fogHex);
  const halfH = Math.max(wallHeight / 2, 1e-4);
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: tintHex,
    transparent: true,
    depthWrite: true,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWallFogColor = { value: fogColor };
    shader.uniforms.uWallHalfH = { value: halfH };
    shader.uniforms.uFadeStart = { value: WALL_FOG_FADE_START };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vWallLocalY;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vWallLocalY = position.y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uWallFogColor;
uniform float uWallHalfH;
uniform float uFadeStart;
varying float vWallLocalY;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float t = clamp(vWallLocalY / uWallHalfH * 0.5 + 0.5, 0.0, 1.0);
  float fade = t <= uFadeStart ? 1.0 : (1.0 - smoothstep(uFadeStart, 1.0, t));
  float soft = fade * fade;
  diffuseColor.rgb = mix(uWallFogColor, diffuseColor.rgb, soft);
  diffuseColor.a *= mix(0.06, 1.0, soft);
}`,
      );
  };

  mat.customProgramCacheKey = () => "epic49-wall-fog-fade-local-v2";
  return mat;
}

/**
 * Large inverted sphere with a vertex-colored vertical gradient — the
 * standard cheap Three.js "gradient sky" technique (EPIC 10 Story 10.2).
 * EPIC 49: `topColor` / `horizonColor` come from the active map palette;
 * callers must dispose the previous sky mesh when rebuilding.
 */
export function buildSkyDome(
  topHex = 0x6fb2e8,
  horizonHex = 0xf3d9a8,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(480, 24, 16);
  const topColor = new THREE.Color(topHex);
  const horizonColor = new THREE.Color(horizonHex);

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
