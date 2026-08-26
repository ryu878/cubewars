// EPIC 51: in-match developer console overlay (~ / Backquote). Transport only.

import { shouldIgnoreGameHotkey } from "./uiInput";

export type DevConsoleSend = (command: string) => void;

export class DevConsole {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private open = false;
  private readonly sendCommand: DevConsoleSend;

  constructor(sendCommand: DevConsoleSend) {
    this.sendCommand = sendCommand;
    this.root = document.getElementById("devConsole") as HTMLElement;
    this.logEl = document.getElementById("devConsoleLog") as HTMLElement;
    this.inputEl = document.getElementById("devConsoleInput") as HTMLInputElement;

    this.inputEl.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.code === "Escape") {
        event.preventDefault();
        this.setOpen(false);
        return;
      }
      if (event.code === "Enter") {
        event.preventDefault();
        const line = this.inputEl.value.trim();
        if (line.length > 0) {
          this.appendLocal(`> ${line}`);
          this.sendCommand(line);
        }
        this.inputEl.value = "";
      }
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(next: boolean): void {
    this.open = next;
    this.root.classList.toggle("visible", next);
    this.root.setAttribute("aria-hidden", next ? "false" : "true");
    if (next) {
      this.inputEl.focus();
    } else {
      this.inputEl.blur();
    }
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  appendResult(ok: boolean, message: string): void {
    this.appendLocal(ok ? message : `[error] ${message}`, ok ? "ok" : "err");
  }

  private appendLocal(text: string, kind: "ok" | "err" | "local" = "local"): void {
    const line = document.createElement("div");
    line.className = `dev-console-line dev-console-${kind}`;
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * Returns true when the event was consumed (console open or toggle handled).
   * Call from a capturing keydown listener before other game hotkeys.
   */
  handleKeyDown(
    event: KeyboardEvent,
    context: { joinedMatch: boolean; pauseMenuOpen: boolean },
  ): boolean {
    if (this.open) {
      if (event.code === "Backquote" || event.code === "Escape") {
        if (!event.repeat) this.toggle();
        event.preventDefault();
        return true;
      }
      // Let typing in the input proceed; block gameplay keys elsewhere.
      if (event.target !== this.inputEl) {
        event.preventDefault();
      }
      return true;
    }

    if (event.code !== "Backquote" || event.repeat) return false;
    if (!context.joinedMatch || context.pauseMenuOpen) return false;
    if (shouldIgnoreGameHotkey(event)) return false;
    this.toggle();
    event.preventDefault();
    return true;
  }
}
