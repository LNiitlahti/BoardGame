# Tournament Dry-Run Script

A single mock-tournament session, run start-to-finish on a **test tournament** (not the real event doc), that exercises every ticked item from `TOURNAMENT_READINESS_CHECKLIST.md`. Ordered so each step naturally sets up the next. Grab 2-4 people to act as players/admin so multi-device sync actually gets tested, not simulated with browser tabs.

Setup: create a throwaway tournament named e.g. `DRYRUN-<date>` so nothing pollutes real data. Use 2 spare/test accounts plus your own.

---

## Stage 0 — Devices needed
- [ ] Admin laptop (primary)
- [ ] Admin phone or second laptop (for A8 multi-device + god.html check)
- [ ] 2 player phones/laptops (for onboarding + real-time sync checks)
- [ ] TV/view.html screen or a third monitor open to `view.html`

## Stage 1 — Registration & security (B1)
1. [ ] God generates a referral code.
2. [ ] Player A registers with it end-to-end on their own device → lands correctly, no admin/god flags set.
3. [ ] Player A (or you, via devtools) tries to re-register with the **same** referral code from a second browser → must fail (already used).
4. [ ] Attempt (via devtools console on a signed-in non-admin account) to `update` your own `users/{uid}` doc setting `isAdmin: true` directly → must be rejected by rules, not just hidden by UI.
5. [ ] Try registering with an email already in use → clear error shown, not a silent failure/hang.
6. [ ] Trigger password reset for Player A's account → email arrives, reset works, can log back in.

## Stage 2 — Tournament creation & state machine (A1)
7. [ ] Create `DRYRUN-<date>` tournament from scratch in admin.html, walk `setup → playing`.
8. [ ] Switch to a different (real or another dummy) tournament in the dropdown and back — confirm teams/board/queue for DRYRUN don't leak into the other one or vice versa.
9. [ ] Click "archive" mid-tournament, confirm there's a confirm dialog and (if you proceed) that god can un-archive it back to `playing`. Also confirm plain `admin` role cannot un-archive or edit while archived.

## Stage 3 — Team assignment (B2) + real-time sync (B3)
10. [ ] Admin assigns Player A to Team 1 via user-management flow. Watch Player A's own device (team.html/index.html) — does it update without a manual refresh?
11. [ ] Watch the TV/view.html screen at the same time — does the team roster update live there too?
12. [ ] Try assigning a 3rd player to a team that already has 2 → must be blocked, with a clear message, both via admin.js path and user-management.js path.
13. [ ] Take an existing placeholder-name slot (create one manually first) and use "replace placeholder with real user" to link Player B's account to it → confirm the placeholder's history/points carry over, no duplicate player appears.
14. [ ] Un-assign a player from their team → confirm they disappear from the team view on all open devices promptly.
15. [ ] Simulate the actual event pattern: assign 2 players live while 2 more are "pre-registered but unassigned" sitting in the pool — confirm the pool/assigned lists stay correct throughout.

## Stage 4 — Phase-driven round flow (A2)
16. [ ] Run one full round through every phase in order: `pre_game_setup → scoring_vp → scoring_hex → hex_placement_1 → spell_window_1 → hex_placement_2 → challenges → spell_window_2 → challenge_game → spell_window_3 → board_resolved → spell_window_4 → matches_in_progress → round_advance → break`.
17. [ ] At each phase, click "Next Phase" and confirm it always advances when requirements are visibly met (note any phase where it silently does nothing).
18. [ ] Deliberately get "stuck" in a phase (e.g. skip a required action) and use "Force Advance" → confirm the tournament state afterward is still coherent (no orphaned pending actions, board/queue still make sense).
19. [ ] Mid-round, insert a break (food/piss/sleep type), let it run, resume → confirm the phase you were in before the break resumes correctly, not reset or skipped.
20. [ ] Check break interval settings and "skip next break" actually change behavior on the next break trigger.
21. [ ] Confirm round-advance is fully driven by the phase manager now — it should prompt automatically at the right point, not require the legacy manual "Advance Round" button.

## Stage 5 — Match queue & scoring (A3) + board (A4)
22. [ ] Manually add a match, assign teams/players to each side, start it, confirm the result with a specific winner + point value → verify standings update to the *correct* team, not the mirrored/opposite one (easy silent bug).
23. [ ] Use Quick-Confirm on a second match → same check, correct team gets points.
24. [ ] Queue a 3rd match, then edit it (swap a player/team) before starting → confirm the edit sticks and doesn't create a duplicate queue entry.
25. [ ] Reorder the queue via drag/drop and via "move to top" → confirm no match is lost or duplicated.
26. [ ] Trigger "Clear queue" → confirm it requires a real confirmation step (not a single click) given it's irreversible.
27. [ ] Create a contested-hex scenario, run the full challenge → confirm → resolve loop end to end.
28. [ ] Assign a team to a hex via the team-picker modal, confirm it appears instantly on view.html/TV.
29. [ ] Use `deleteLastTileCaptureEvent` after two consecutive hex captures → confirm it removes the *most recent* event only, not an arbitrary one.

## Stage 6 — Manual overrides & recovery (A5, A6)
30. [ ] Manually adjust a team's points up and down → standings update instantly, and an audit log entry is created you can find afterward.
31. [ ] Add and remove players from a team via admin.js directly (not user-management) → 2-player cap still enforced.
32. [ ] Rename a team and change its color mid-tournament → confirm match history and board hex ownership still display correctly (no broken references).
33. [ ] Drag-reorder seating positions, then reset seating order → confirm it returns to the expected default.

## Stage 7 — Stress conditions (A8)
34. [ ] With the admin laptop and admin phone both open on the same tournament, make a change on one (e.g. confirm a match result) → confirm the other device picks it up without conflict/overwrite.
35. [ ] Mid-round, hard-refresh the admin laptop (simulating a crash) → confirm on reload the exact phase and queue state is restored, not reset to an earlier phase.
36. [ ] Throttle network (devtools "Slow 3G" or turn off wifi briefly) while making a change → confirm the UI shows a pending/offline indicator rather than silently losing the write.
37. [ ] Confirm with the God-role person: they understand god.html is only for pre/post-tournament use and must NOT be touched once the tournament is live (verbal/written confirmation, not a code check).

## Stage 8 — Onboarding checklist (B4)
38. [ ] Player A fills in platform IDs, marks friends-added, marks games-tested in onboarding.html → refresh the page → data persisted.
39. [ ] Admin's 10-player summary grid (onboarding.html?view=true) reflects Player A's status live.
40. [ ] Have Player A and Player B both toggle their onboarding status within the same second (race condition test) → check afterward that neither player's data got silently overwritten by the other's write. If it does overwrite, decide: acceptable risk for one night, or worth a quick transaction-based fix.

## Stage 9 — Security file check (B5)
41. [ ] Confirm which rules file (`firestore.rules` vs `firestore.rules.temp`) is actually the one deployed to the live Firebase project (`firebase deploy` history / Firebase console → Firestore → Rules tab). If `.rules.temp`'s permissive rules are somehow live, the anti-privilege-escalation and admin-only checks tested above don't actually hold in production.

---

## After the dry run
Log every failure/surprise here (or in a copy of this file) with the stage number, what happened, and severity. Anything 🔴 that fails should get fixed and re-tested before the LAN; 🟡/⚪ failures are judgment calls given the 1-week runway.
