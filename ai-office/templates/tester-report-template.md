# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | |
| Task / Story / EPIC | |
| Handoff from Pusya (link/commit) | |
| Status | **PASS** / **FAIL** |
| Re-verify after Critic/Judge revision? | no / yes — finding IDs re-checked: |

## Environment

- OS / Docker:
- Branch / commit:

## Check results

### Build

- Command:
- Result: OK / FAIL —

### Run

- Command:
- Result: OK / FAIL —

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| | | |

### Config and secrets

- `config.vars.example` / README up to date: yes / no
- No secrets in diff: yes / no

### Documentation

- README / docs updated: yes / no

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes / no / N/A

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/<task-id>/...` (or N/A with reason)
- Movement: OK / broken / N/A —
- Jump: OK / broken / N/A —
- Shoot / hit registration: OK / broken / N/A —
- Camera / controls feel: OK / janky / N/A —
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK / issues found / N/A —
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes / no / N/A —

## On FAIL: reproduction

### Failure reason

- FAIL cause:

1. Steps:
2. Expected:
3. Got:
4. Logs / screenshots:

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: …
- **FAIL:** not ready; return to Pusya per `ai-office/process/process-rework-loop.md`. Reason: …
