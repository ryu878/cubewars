// EPIC 49: per-MapId visual palettes (atmosphere + default material tints).
// Collision/authority stay server-side; this module is client-only cosmetics.

import * as THREE from "three";
import { DEFAULT_MAP_ID, MAP_IDS, ARENA_BOUNDS, type MapId } from "@cubewars/shared";
import { buildGroundTexture, buildSkyDome, type GroundThemeId } from "./textures";

/** Theme key: catalog maps, endless default, or lobby reset. */
export type MapThemeId = MapId | "endless" | "lobby";

export interface MapPalette {
  /** Ground plane albedo. */
  ground: number;
  /** Multiplies wood/brick wall textures. */
  wallTint: number;
  /** Multiplies wood/brick crate textures (often warmer/greener). */
  crateTint: number;
  /** Default prop metal when no id-prefix match. */
  propMetal: number;
  /** Accent for car bodies / landmark hulls. */
  propAccent: number;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Optional crystal/lab emissive accent. */
  emissiveAccent: number;
  emissiveIntensity: number;
}

/** Scene objects mutate by applyMapTheme (no per-frame work). */
export interface MapThemeScene {
  scene: THREE.Scene;
  groundMat: THREE.MeshStandardMaterial;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  /** Current sky dome mesh; replaced and disposed on theme change. */
  skyDome: THREE.Mesh | null;
  /** EPIC 58: ground procedural texture; disposed on theme swap. */
  groundTexture: THREE.Texture | null;
}

export const MAP_PALETTES: Record<MapId, MapPalette> = {
  base: {
    ground: 0xe3c98c,
    wallTint: 0xffffff,
    crateTint: 0xf0e0c8,
    propMetal: 0x3a4550,
    propAccent: 0x6b4a2e,
    skyTop: 0x6fb2e8,
    skyHorizon: 0xf3d9a8,
    fogColor: 0xf3d9a8,
    fogNear: 360,
    fogFar: 2100,
    hemiSky: 0xfff3d6,
    hemiGround: 0x8a7355,
    hemiIntensity: 0.95,
    sunColor: 0xfff0d0,
    sunIntensity: 1.3,
    emissiveAccent: 0x101418,
    emissiveIntensity: 0.12,
  },
  rust_canyon: {
    ground: 0xc47a4a,
    wallTint: 0xd4a07a,
    crateTint: 0xb86a40,
    propMetal: 0x5a4030,
    propAccent: 0x8a5030,
    skyTop: 0xd4a070,
    skyHorizon: 0xe8b888,
    fogColor: 0xd9a878,
    fogNear: 270,
    fogFar: 1560,
    hemiSky: 0xffe0c0,
    hemiGround: 0x6a4030,
    hemiIntensity: 0.9,
    sunColor: 0xffd0a0,
    sunIntensity: 1.15,
    emissiveAccent: 0x2a1810,
    emissiveIntensity: 0.1,
  },
  glass_dome: {
    ground: 0xb8c9a8,
    wallTint: 0xc8d8d0,
    crateTint: 0x6a9a58,
    propMetal: 0x6a7a78,
    propAccent: 0x4a8a60,
    skyTop: 0x7ec8b8,
    skyHorizon: 0xc8e0d0,
    fogColor: 0xb8d0c4,
    fogNear: 120,
    fogFar: 840,
    hemiSky: 0xd8f0e8,
    hemiGround: 0x5a6a50,
    hemiIntensity: 0.85,
    sunColor: 0xe8fff0,
    sunIntensity: 0.95,
    emissiveAccent: 0x204030,
    emissiveIntensity: 0.18,
  },
  dead_station: {
    ground: 0x6a6e72,
    wallTint: 0x8a9098,
    crateTint: 0x707880,
    propMetal: 0x4a5058,
    propAccent: 0x3a6080,
    skyTop: 0x2a3548,
    skyHorizon: 0x6a7080,
    fogColor: 0x5a6070,
    fogNear: 240,
    fogFar: 1440,
    hemiSky: 0xa0b0c8,
    hemiGround: 0x404850,
    hemiIntensity: 0.75,
    sunColor: 0xd0d8e8,
    sunIntensity: 1.05,
    emissiveAccent: 0x102030,
    emissiveIntensity: 0.14,
  },
  fuel_depot: {
    ground: 0x8a7a60,
    wallTint: 0xa09070,
    crateTint: 0x907040,
    propMetal: 0x5a5850,
    propAccent: 0xb05020,
    skyTop: 0x8aa0b0,
    skyHorizon: 0xc8b090,
    fogColor: 0xb0a080,
    fogNear: 210,
    fogFar: 1350,
    hemiSky: 0xe8d8b0,
    hemiGround: 0x5a5040,
    hemiIntensity: 0.88,
    sunColor: 0xffe8c0,
    sunIntensity: 1.2,
    emissiveAccent: 0x301808,
    emissiveIntensity: 0.12,
  },
  crystal_cave: {
    ground: 0x3a3858,
    wallTint: 0x5a5878,
    crateTint: 0x4a4868,
    propMetal: 0x4a4a60,
    propAccent: 0x80c0ff,
    skyTop: 0x1a1838,
    skyHorizon: 0x3a3860,
    fogColor: 0x2a2848,
    fogNear: 150,
    fogFar: 960,
    hemiSky: 0x6870a0,
    hemiGround: 0x282438,
    hemiIntensity: 0.7,
    sunColor: 0xa0c0ff,
    sunIntensity: 0.75,
    emissiveAccent: 0x60a0ff,
    emissiveIntensity: 0.55,
  },
  abyss_bridge: {
    ground: 0x5a5e68,
    wallTint: 0x707880,
    crateTint: 0x687078,
    propMetal: 0x3a4048,
    propAccent: 0x506070,
    skyTop: 0x4a5870,
    skyHorizon: 0x8890a0,
    fogColor: 0x687080,
    fogNear: 105,
    fogFar: 780,
    hemiSky: 0xb0c0d8,
    hemiGround: 0x383c48,
    hemiIntensity: 0.7,
    sunColor: 0xd0d8e8,
    sunIntensity: 0.9,
    emissiveAccent: 0x101820,
    emissiveIntensity: 0.1,
  },
  elite_quarter: {
    ground: 0xb8a898,
    wallTint: 0xc8b8a8,
    crateTint: 0xa89080,
    propMetal: 0x585860,
    propAccent: 0x8a7060,
    skyTop: 0x88a8c8,
    skyHorizon: 0xd8c8b0,
    fogColor: 0xc8b8a0,
    fogNear: 300,
    fogFar: 1680,
    hemiSky: 0xf0e8d8,
    hemiGround: 0x6a6058,
    hemiIntensity: 0.92,
    sunColor: 0xfff0e0,
    sunIntensity: 1.15,
    emissiveAccent: 0x181410,
    emissiveIntensity: 0.1,
  },
};

/** Endless uses Base-like desert atmosphere (maze chunks stay readable). */
export const ENDLESS_PALETTE: MapPalette = { ...MAP_PALETTES.base };

/** Lobby / leave reset — same warm classic desert as Base. */
export const LOBBY_PALETTE: MapPalette = { ...MAP_PALETTES.base };

let activeThemeId: MapThemeId = "lobby";

export function getActiveThemeId(): MapThemeId {
  return activeThemeId;
}

export function getPalette(themeId: MapThemeId = activeThemeId): MapPalette {
  if (themeId === "endless" || themeId === "lobby") {
    return themeId === "endless" ? ENDLESS_PALETTE : LOBBY_PALETTE;
  }
  return MAP_PALETTES[themeId] ?? MAP_PALETTES[DEFAULT_MAP_ID];
}

/**
 * Cheap distinctness check: every catalog map differs on ground OR fog OR skyHorizon.
 * Used by regression:epic49-palettes.
 */
export function assertPalettesDistinct(): void {
  const keys: (keyof MapPalette)[] = ["ground", "fogColor", "skyHorizon", "wallTint", "propAccent"];
  for (let i = 0; i < MAP_IDS.length; i++) {
    for (let j = i + 1; j < MAP_IDS.length; j++) {
      const a = MAP_PALETTES[MAP_IDS[i]!];
      const b = MAP_PALETTES[MAP_IDS[j]!];
      const differs = keys.some((k) => a[k] !== b[k]);
      if (!differs) {
        throw new Error(`EPIC 49: palettes for ${MAP_IDS[i]} and ${MAP_IDS[j]} are identical`);
      }
    }
  }
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if ("map" in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

/**
 * Apply atmosphere for a map (or lobby/endless). Rebuilds sky once per change;
 * updates fog, ground, and lights. Call on every map_state and leave→lobby.
 */
export function applyMapTheme(themeId: MapThemeId, targets: MapThemeScene): MapPalette {
  activeThemeId = themeId;
  const palette = getPalette(themeId);

  if (targets.groundTexture) {
    targets.groundTexture.dispose();
    targets.groundTexture = null;
  }
  const groundTex = buildGroundTexture(themeId as GroundThemeId);
  const GROUND_TILE = 4;
  const groundWidth = ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX + 8;
  const groundDepth = ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ + 8;
  groundTex.repeat.set(groundWidth / GROUND_TILE, groundDepth / GROUND_TILE);
  targets.groundMat.map = groundTex;
  targets.groundMat.color.setHex(palette.ground);
  targets.groundMat.needsUpdate = true;
  targets.groundTexture = groundTex;

  if (targets.scene.fog instanceof THREE.Fog) {
    targets.scene.fog.color.setHex(palette.fogColor);
    targets.scene.fog.near = palette.fogNear;
    targets.scene.fog.far = palette.fogFar;
  } else {
    targets.scene.fog = new THREE.Fog(palette.fogColor, palette.fogNear, palette.fogFar);
  }

  targets.hemiLight.color.setHex(palette.hemiSky);
  targets.hemiLight.groundColor.setHex(palette.hemiGround);
  targets.hemiLight.intensity = palette.hemiIntensity;

  targets.sunLight.color.setHex(palette.sunColor);
  targets.sunLight.intensity = palette.sunIntensity;

  if (targets.skyDome) {
    targets.scene.remove(targets.skyDome);
    disposeObject3D(targets.skyDome);
  }
  const sky = buildSkyDome(palette.skyTop, palette.skyHorizon);
  targets.scene.add(sky);
  targets.skyDome = sky;

  return palette;
}

/** Resolve theme id from map_state / match mode. */
export function themeIdFromMapState(mapId: MapId | null | undefined, endless: boolean): MapThemeId {
  if (endless) return "endless";
  if (mapId) return mapId;
  return DEFAULT_MAP_ID;
}
