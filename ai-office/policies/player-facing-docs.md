# Player-facing mechanics documentation (mandatory)

When shipping **player-facing mechanic changes** or **new player-facing features**, the same delivery (EPIC / PR) **must**:

1. Update **`client/public/about.html`** (and images under `client/public/about/` when visuals help explain the change).
2. Bump the About page **Last updated** date.
3. Add a **Changelog** entry in **`client/public/changelog.json`** (newest first).

Do **not** defer About/Changelog to a follow-up task. This rule is also part of Definition of Done in `ai-office/global/global-standards.mdc`.

Protocol codes, server logs, and developer-only console cheat docs are out of scope for About; translate or document only what players see.
