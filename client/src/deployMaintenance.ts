// Polls /maintenance.json during production deploys — full-screen banner
// before/during server restart. Hidden when active=false or file missing.

import { subscribe, t } from "./i18n";

export interface MaintenanceState {
  active: boolean;
  phase?: "countdown" | "updating";
  /** Epoch ms — used when phase is countdown. */
  countdownEndsAt?: number;
}

const POLL_MS = 400;

function parseState(raw: unknown): MaintenanceState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return { active: false };
  const phase = o.phase === "countdown" || o.phase === "updating" ? o.phase : "updating";
  const countdownEndsAt =
    typeof o.countdownEndsAt === "number" && Number.isFinite(o.countdownEndsAt)
      ? o.countdownEndsAt
      : undefined;
  return { active: true, phase, countdownEndsAt };
}

function countdownSecondsRemaining(state: MaintenanceState): number {
  if (!state.countdownEndsAt) return 5;
  return Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000));
}

export interface DeployMaintenanceWatch {
  stop: () => void;
  isBlocking: () => boolean;
}

/**
 * Shows #deployMaintenance while maintenance.json reports active.
 * Calls onEnded once when deploy finishes (banner hides) — use to reload/reconnect.
 */
export function startDeployMaintenanceWatch(onEnded?: () => void): DeployMaintenanceWatch {
  const root = document.getElementById("deployMaintenance");
  const titleEl = document.getElementById("deployMaintenanceTitle");
  const subEl = document.getElementById("deployMaintenanceSub");
  if (!root || !titleEl || !subEl) {
    return { stop: () => {}, isBlocking: () => false };
  }

  let blocking = false;
  let wasBlocking = false;

  const render = (state: MaintenanceState | null) => {
    const active = state?.active === true;
    blocking = active;
    if (!active) {
      root.hidden = true;
      if (wasBlocking) onEnded?.();
      wasBlocking = false;
      return;
    }
    wasBlocking = true;
    root.hidden = false;
    if (state.phase === "countdown") {
      const sec = countdownSecondsRemaining(state);
      titleEl.textContent = t("deploy.bannerCountdown", { seconds: sec });
      subEl.textContent = "";
      subEl.hidden = true;
    } else {
      titleEl.textContent = t("deploy.bannerUpdating");
      subEl.textContent = "";
      subEl.hidden = true;
    }
  };

  const refreshText = () => {
    if (!blocking) return;
    void poll();
  };

  const localeOff = subscribe(() => {
    refreshText();
  });

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(`/maintenance.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        render({ active: false });
        return;
      }
      const data: unknown = await res.json();
      render(parseState(data));
    } catch {
      render({ active: false });
    }
  };

  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);

  return {
    stop: () => {
      window.clearInterval(timer);
      localeOff();
    },
    isBlocking: () => blocking,
  };
}
