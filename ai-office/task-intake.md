# Unified task intake template

All work is specified in the hierarchy **EPIC → Story → Task**. Fill this in before development starts. Approved by the Team Lead.

**Who receives the specification:** only **Team Lead** (`ai-office/agents/team-lead/role.mdc`). The user does not assign tasks directly to the Programmer, Tester, Critic, or Judge.

---

## 1. EPIC (large area / system)

| Field | Description |
|-------|-------------|
| **Name** | |
| **System goal** | What is being built at the product level |
| **Business/gameplay problem** | Which problem we solve |
| **Architectural role** | client (renderer/UI/input) / game server (authoritative state) / matchmaking / persistence / API / shared protocol |
| **Main components** | List |
| **Stack** | Fixed project-wide, see `ai-office/global/global-standards.mdc` (Three.js/TS client + Vite, Node.js/TS + `ws` server, shared `shared/` protocol package, Rapier only if physics is explicitly in scope) — state which pieces this EPIC touches |
| **Interaction with other components** | Who calls whom, who calls us, data/protocol format |

---

## 2. Story (capability within an EPIC)

Format: **As a** \<actor\> **I want** \<capability\> **So that** \<result\>.

| Field | Description |
|-------|-------------|
| **Name** | |
| **As a** | Role/system (player, client, server, admin, …) |
| **I want** | Capability (join a match, see other players move, spend resources, …) |
| **So that** | Outcome/value |
| **Description** | Function details |
| **Inputs** | |
| **Outputs** | |
| **Constraints** | |
| **Dependencies** | Other Stories, services, APIs |
| **Acceptance criteria** | Done checklist when everything is complete |

---

## 3. Tasks (engineering steps)

Each Task is one concrete, measurable piece of work.

| # | Task (wording) | Expected result | Place in code/service | Completion criterion |
|---|----------------|-----------------|------------------------|----------------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

**Task requirements:**

- Technical wording (not "make it work", but "implement server-side movement validation", "add endpoint `POST /api/v1/match/join`", "create match-state Redux slice").
- Clear where in the repository/service this is done.
- Clear completion criterion (tests pass, endpoint returns 200, client renders correctly, etc.).
- If the task touches gameplay-relevant state, state explicitly that the server is authoritative and what the client is allowed to predict/render only.

---

## 4. Additional (when needed)

| Section | Content |
|---------|---------|
| **Architecture** | Component diagram, data flows |
| **Project structure** | New folders, modules, services |
| **API / protocol contracts** | Method, path, request/response body, message types, error codes |
| **Data format** | JSON/binary schemas, types, examples |
| **Risks and constraints** | Performance, compatibility, migrations, cheating/exploit surface |

---

## 5. Sign-off

- **Specification (author):** ________________  date _______
- **Approval (Team Lead):** ________________  date _______
- **Assignee:** ________________

---

## Short fill-in example

**EPIC:** Match Server — authoritative real-time state for a single game match.

**Story:** Player movement
As a *game server* I want *to validate and broadcast player movement* so that *all clients see a consistent, cheat-resistant world state*.

**Tasks:**

1. Implement server-side movement validation (speed/bounds clamp) in the match loop.
2. Broadcast validated position deltas to all connected clients over WebSocket.
3. Add client-side prediction + reconciliation for the local player.
4. Add a movement-rate-limit guard against flooded input.

After fill-in and approval, use during development and mark completed Tasks/Stories.
