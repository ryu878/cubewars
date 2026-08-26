/** EPIC 51: server-side dev console cheat gate helpers (testable, no transport). */

export const DEV_CONSOLE_MAX_COMMAND_LEN = 64;

/** Default allow when unset; explicit `CUBEWARS_ENABLE_CHEATS=0` disables. */
export function cheatsEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CUBEWARS_ENABLE_CHEATS !== "0";
}

export function normalizeDevConsoleCommand(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True for get_pet / get_amulet / god_mode — IDDQD is the unlock command itself. */
export function devConsoleRequiresUnlock(command: string): boolean {
  return command !== "iddqd";
}

export type DevConsoleCommand = "iddqd" | "get_pet" | "get_amulet" | "god_mode";

export function parseDevConsoleCommand(raw: string): DevConsoleCommand | null {
  const cmd = normalizeDevConsoleCommand(raw);
  if (cmd === "iddqd" || cmd === "get_pet" || cmd === "get_amulet" || cmd === "god_mode") {
    return cmd;
  }
  return null;
}
