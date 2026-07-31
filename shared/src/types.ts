// Small shared primitive types. Split out from index.ts so map data and
// collision code (EPIC 3) can depend on Vector3 without a circular import
// back into index.ts (which re-exports them).

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
