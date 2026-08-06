export const NICKNAME_LIMITS = {
  minLength: 3,
  maxLength: 16,
} as const;

export type NicknameValidation =
  | { ok: true; nickname: string; key: string }
  | { ok: false; reason: "too_short" | "too_long" | "invalid_characters" };

const ALLOWED_NICKNAME_PATTERN = /^[\p{L}\p{N}_ -]+$/u;

export function normalizeNickname(raw: unknown): NicknameValidation {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_characters" };
  const nickname = raw.trim().replace(/\s+/g, " ");
  const length = Array.from(nickname).length;
  if (length < NICKNAME_LIMITS.minLength) return { ok: false, reason: "too_short" };
  if (length > NICKNAME_LIMITS.maxLength) return { ok: false, reason: "too_long" };
  if (!ALLOWED_NICKNAME_PATTERN.test(nickname)) return { ok: false, reason: "invalid_characters" };
  return { ok: true, nickname, key: nickname.toLocaleLowerCase() };
}
