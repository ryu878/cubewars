// EPIC 34: lobby account auth UI (email + display-code stub, session resume).
// Plain HTML/CSS + TypeScript — no UI framework. Transport stays in network.ts;
// this module only owns the auth overlay DOM and localStorage token persistence.

export const SESSION_TOKEN_STORAGE_KEY = "cubewars_session_token";

export type AccountAuthSend = (message: {
  type: "account_register" | "account_login" | "account_session_resume";
  email?: string;
  code?: string;
  token?: string;
}) => void;

export interface AccountAuthCallbacks {
  /** Fired once the connection is authenticated (register / login / resume). */
  onAuthenticated: (info: { email: string; accountId: string }) => void;
}

type AuthPhase = "email" | "code" | "code_reveal" | "authenticated";

export class AccountAuth {
  private panelEl: HTMLElement;
  private signedInEl: HTMLElement;
  private signedInEmailEl: HTMLElement;
  private emailStepEl: HTMLElement;
  private codeStepEl: HTMLElement;
  private revealStepEl: HTMLElement;
  private emailInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private emailBtn: HTMLButtonElement;
  private codeBtn: HTMLButtonElement;
  private continueBtn: HTMLButtonElement;
  private errorEl: HTMLElement;
  private revealCodeEl: HTMLElement;
  private pending = false;
  private phase: AuthPhase = "email";
  private pendingEmail = "";
  private accountId = "";
  private email = "";
  private welcomeReady = false;

  constructor(
    private send: AccountAuthSend,
    private callbacks: AccountAuthCallbacks,
  ) {
    this.panelEl = document.getElementById("accountAuth") as HTMLElement;
    this.signedInEl = document.getElementById("accountSignedIn") as HTMLElement;
    this.signedInEmailEl = document.getElementById("accountSignedInEmail") as HTMLElement;
    this.emailStepEl = document.getElementById("accountEmailStep") as HTMLElement;
    this.codeStepEl = document.getElementById("accountCodeStep") as HTMLElement;
    this.revealStepEl = document.getElementById("accountCodeReveal") as HTMLElement;
    this.emailInput = document.getElementById("accountEmailInput") as HTMLInputElement;
    this.codeInput = document.getElementById("accountCodeInput") as HTMLInputElement;
    this.emailBtn = document.getElementById("accountEmailBtn") as HTMLButtonElement;
    this.codeBtn = document.getElementById("accountCodeBtn") as HTMLButtonElement;
    this.continueBtn = document.getElementById("accountContinueBtn") as HTMLButtonElement;
    this.errorEl = document.getElementById("accountAuthError") as HTMLElement;
    this.revealCodeEl = document.getElementById("accountRevealCode") as HTMLElement;

    this.emailBtn.addEventListener("click", () => this.submitEmail());
    this.codeBtn.addEventListener("click", () => this.submitCode());
    this.continueBtn.addEventListener("click", () => this.finishReveal());
    this.emailInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submitEmail();
    });
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submitCode();
    });
    this.emailInput.addEventListener("input", () => {
      this.errorEl.textContent = "";
    });
    this.codeInput.addEventListener("input", () => {
      this.errorEl.textContent = "";
    });

    this.showPhase("email");
  }

  /** Call once the WS connection has received `welcome`. */
  onWelcome(): void {
    this.welcomeReady = true;
    const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (token) {
      this.pending = true;
      this.setBusy(true);
      this.errorEl.textContent = "Restoring session…";
      this.send({ type: "account_session_resume", token });
      return;
    }
    this.showPhase("email");
    this.setBusy(false);
  }

  handleAccountCreated(message: {
    accountId: string;
    email: string;
    code: string;
    token: string;
  }): void {
    this.pending = false;
    this.setBusy(false);
    this.storeToken(message.token);
    this.accountId = message.accountId;
    this.email = message.email;
    this.revealCodeEl.textContent = message.code;
    this.showPhase("code_reveal");
  }

  handleLoginResult(message: {
    ok: boolean;
    accountId?: string;
    email?: string;
    token?: string;
    reason?: string;
  }): void {
    this.pending = false;
    this.setBusy(false);
    if (message.ok && message.token && message.email && message.accountId) {
      this.storeToken(message.token);
      this.markAuthenticated(message.email, message.accountId);
      return;
    }
    if (message.reason === "code_required") {
      this.showPhase("code");
      this.errorEl.textContent = "Enter the login code for this email.";
      this.codeInput.focus();
      return;
    }
    if (message.reason === "rate_limited") {
      this.errorEl.textContent = "Too many attempts — try again later.";
      return;
    }
    if (message.reason === "invalid_email") {
      this.errorEl.textContent = "Enter a valid email address.";
      this.showPhase("email");
      return;
    }
    if (message.reason === "already_authenticated") {
      // Should not happen in normal UI flow; treat as soft success if we have state.
      if (this.email && this.accountId) {
        this.markAuthenticated(this.email, this.accountId);
      }
      return;
    }
    // Generic — do not distinguish missing email vs wrong code.
    this.errorEl.textContent = "Email or code is incorrect.";
    if (this.phase !== "code") this.showPhase("code");
  }

  handleSessionResult(message: {
    ok: boolean;
    accountId?: string;
    email?: string;
    reason?: string;
  }): void {
    this.pending = false;
    this.setBusy(false);
    if (message.ok && message.email && message.accountId) {
      this.markAuthenticated(message.email, message.accountId);
      return;
    }
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    this.errorEl.textContent = "";
    this.showPhase("email");
  }

  isAuthenticated(): boolean {
    return this.phase === "authenticated";
  }

  private submitEmail(): void {
    if (!this.welcomeReady || this.pending) return;
    const email = this.emailInput.value.trim();
    if (!email.includes("@")) {
      this.errorEl.textContent = "Enter a valid email address.";
      return;
    }
    this.pendingEmail = email;
    this.pending = true;
    this.setBusy(true);
    this.errorEl.textContent = "";
    // Always try register first; server replies code_required if the email exists.
    this.send({ type: "account_register", email });
  }

  private submitCode(): void {
    if (!this.welcomeReady || this.pending) return;
    const email = this.pendingEmail || this.emailInput.value.trim();
    const code = this.codeInput.value.trim();
    if (!email || !code) {
      this.errorEl.textContent = "Enter email and code.";
      return;
    }
    this.pending = true;
    this.setBusy(true);
    this.errorEl.textContent = "";
    this.send({ type: "account_login", email, code });
  }

  private finishReveal(): void {
    if (!this.email || !this.accountId) return;
    this.markAuthenticated(this.email, this.accountId);
  }

  private markAuthenticated(email: string, accountId: string): void {
    this.email = email;
    this.accountId = accountId;
    this.phase = "authenticated";
    this.pending = false;
    this.setBusy(false);
    this.errorEl.textContent = "";
    this.signedInEmailEl.textContent = email;
    this.showPhase("authenticated");
    this.callbacks.onAuthenticated({ email, accountId });
  }

  private storeToken(token: string): void {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  }

  private showPhase(phase: AuthPhase): void {
    this.phase = phase;
    const authed = phase === "authenticated";
    this.panelEl.classList.toggle("hidden", authed);
    this.signedInEl.classList.toggle("hidden", !authed);
    this.emailStepEl.classList.toggle("hidden", phase !== "email");
    this.codeStepEl.classList.toggle("hidden", phase !== "code");
    this.revealStepEl.classList.toggle("hidden", phase !== "code_reveal");
    if (phase === "code" && this.pendingEmail) {
      this.emailInput.value = this.pendingEmail;
    }
  }

  private setBusy(busy: boolean): void {
    this.emailBtn.disabled = busy || !this.welcomeReady;
    this.codeBtn.disabled = busy || !this.welcomeReady;
    this.continueBtn.disabled = busy;
    this.emailInput.disabled = busy;
    this.codeInput.disabled = busy;
  }
}
