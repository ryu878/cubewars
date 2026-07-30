// Protocol types shared between client and server.
// Consumed directly as TypeScript source (no build step) by both Vite (client)
// and tsx (server) — keep this package dependency-free and framework-agnostic.

export const PROTOCOL_VERSION = 1;

export interface WelcomeMessage {
  type: "welcome";
  protocolVersion: number;
  playerId: string;
  serverTimeMs: number;
}

export type ServerMessage = WelcomeMessage;
