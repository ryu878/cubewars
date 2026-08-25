// Shared gate for gameplay hotkeys vs lobby / form typing.
// Without this, KeyI opens inventory while typing "gmail" on the login screen.

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target.isContentEditable;
}

/** True while the mode-select / auth lobby overlay is still showing. */
export function isLobbyVisible(): boolean {
  const el = document.getElementById("modeSelect");
  return !!el && !el.classList.contains("hidden");
}

/**
 * Game hotkeys (I/P/U/T/F/E/Tab/movement) must not fire on the lobby or
 * while the user is typing in an input — only after join (lobby hidden).
 */
export function shouldIgnoreGameHotkey(event: KeyboardEvent): boolean {
  if (isLobbyVisible()) return true;
  if (isEditableTarget(event.target)) return true;
  return false;
}
