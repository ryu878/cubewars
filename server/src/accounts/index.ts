// EPIC 34: account / session store (Redis).
export {
  AccountStore,
  LOGIN_MAX_FAILURES_PER_CONNECTION,
  LOGIN_MAX_FAILURES_PER_EMAIL,
  LOGIN_RATE_WINDOW_MS,
  SESSION_TTL_MS,
  type AccountRecord,
  type AccountStoreOpenOptions,
  type LoginResult,
  type RegisterResult,
  type ResumeResult,
  type SessionRecord,
} from "./store.js";
