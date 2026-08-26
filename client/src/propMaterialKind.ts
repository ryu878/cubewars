/**
 * Prop id → material kind for `renderMapGeometry`.
 * Order matters: stone/rubble must win over car-body tokens so dry-bed piles
 * like `rc_bed_w_rock_a` are not classified as truck-bed metal.
 * `carSilhouette` only emits `_body` / `_cabin` / `_wheel_*` (no `_hood`/`_bed`).
 */
export type PropMaterialKind =
  | "wheel"
  | "cabin"
  | "rock"
  | "body"
  | "tank_green"
  | "tank_fuel"
  | "crystal"
  | "veg"
  | "cable"
  | "structure"
  | "pipe"
  | "default";

export function propMaterialKind(id: string): PropMaterialKind {
  if (id.includes("_wheel_")) return "wheel";
  if (id.includes("_cabin")) return "cabin";
  if (id.includes("rubble") || id.includes("ruin") || id.includes("_rock_")) return "rock";
  if (id.includes("_body")) return "body";
  if (id.includes("rc_tank_") || id.includes("_turret") || id.includes("_track_")) return "tank_green";
  if (id.includes("fd_tank_") || id.includes("_cistern") || id.includes("_barrel")) return "tank_fuel";
  if (id.includes("cc_crystal_") || id.includes("_crystal_")) return "crystal";
  if (id.includes("veg") || id.includes("_bush_") || id.includes("_plant_")) return "veg";
  if (id.includes("cable") || id.includes("_stay_")) return "cable";
  if (id.includes("tower") || id.includes("hangar") || id.includes("_deck_")) return "structure";
  if (id.includes("pump") || id.includes("pipe")) return "pipe";
  return "default";
}
