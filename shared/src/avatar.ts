// EPIC 33: fixed avatar color palette + wire types.
// Palette indices (not raw hex) travel on the wire so the palette remains the
// single source of truth for which colors are valid.

/** Body-part groups a player can recolor (face accent stays fixed). */
export type AvatarBodyPart = "head" | "torso" | "hands" | "legs";

export const AVATAR_BODY_PARTS: readonly AvatarBodyPart[] = [
  "head",
  "torso",
  "hands",
  "legs",
] as const;

/**
 * Fixed cosmetic palette (~8 colors). Reuses hues already present in the
 * low-poly bright palette (weapon/pickup/avatar defaults) for family
 * resemblance — not a free-form color picker.
 */
export const AVATAR_COLOR_PALETTE: readonly number[] = [
  0x2d6cdf, // default torso blue
  0x2b2d42, // default limb charcoal
  0xf2c197, // default head skin
  0xff8c00, // rifle orange
  0x9b30ff, // grenade purple
  0xd32f2f, // health-cross red
  0x2f6fae, // armor steel blue
  0x36c7e0, // pet-bird cyan
] as const;

/** Palette index per body part — values are indices into AVATAR_COLOR_PALETTE. */
export type AvatarColors = Record<AvatarBodyPart, number>;

/** Default look when a player has never customized (index 0 everywhere). */
export function defaultAvatarColors(): AvatarColors {
  return { head: 0, torso: 0, hands: 0, legs: 0 };
}

export function isAvatarBodyPart(value: unknown): value is AvatarBodyPart {
  return value === "head" || value === "torso" || value === "hands" || value === "legs";
}

export function isValidPaletteIndex(index: unknown): index is number {
  return (
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < AVATAR_COLOR_PALETTE.length
  );
}

export function resolveAvatarColor(paletteIndex: number): number {
  return AVATAR_COLOR_PALETTE[paletteIndex] ?? AVATAR_COLOR_PALETTE[0]!;
}

/** Random in-range palette index (pets, bots). */
export function randomPaletteIndex(): number {
  return Math.floor(Math.random() * AVATAR_COLOR_PALETTE.length);
}

/** Independent random index per body part (bots: visual variety at spawn). */
export function randomAvatarColors(): AvatarColors {
  return {
    head: randomPaletteIndex(),
    torso: randomPaletteIndex(),
    hands: randomPaletteIndex(),
    legs: randomPaletteIndex(),
  };
}

export function cloneAvatarColors(colors: AvatarColors): AvatarColors {
  return {
    head: colors.head,
    torso: colors.torso,
    hands: colors.hands,
    legs: colors.legs,
  };
}

/** Stable string key for equality checks (client material sync). */
export function avatarColorsKey(colors: AvatarColors): string {
  return `${colors.head},${colors.torso},${colors.hands},${colors.legs}`;
}
