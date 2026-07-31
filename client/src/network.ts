// Transport layer only — no game/simulation logic here (per global-standards.mdc).

import type { ClientMessage, ServerMessage, WorldStateMessage } from "@cubewars/shared";

export interface NetworkHandlers {
  onOpen?: () => void;
  onWelcome: (playerId: string) => void;
  onWorldState: (message: WorldStateMessage) => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
}

export class GameConnection {
  private socket: WebSocket;

  constructor(url: string, handlers: NetworkHandlers) {
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => handlers.onOpen?.());

    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "welcome") {
          handlers.onWelcome(message.playerId);
        } else if (message.type === "world_state") {
          handlers.onWorldState(message);
        }
      } catch (err) {
        console.error("[client] failed to parse server message", err);
      }
    });

    this.socket.addEventListener("close", () => handlers.onClose?.());
    this.socket.addEventListener("error", (err) => handlers.onError?.(err));
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
