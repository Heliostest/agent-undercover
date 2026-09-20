# Iterative thinking implementation

Spec: ../specs/2026-09-19-iterative-thinking.md

Global constraints: preserve previous uncommitted work; no keys in artifacts; no hidden game-state access; finite retries and bounded experiments; no automatic win-rate claims or pushes.

## Task 1 — structured private decisions
Produces: ThinkingAgent implementing SeatAgent; Strategy = baseline | evidence initially; bounded validated DecisionBrief; think usage phase.
Consumes: AgentView, PlayerAgent, LlmClient, UsageSink.
- [x] Write failing tests for grounded citations, private memory isolation, planner failure and timeout, usage, reuse of speech validation.
- [x] Implement a small planner/actor wrapper with actual-action memory and immutable version prompts.
- [x] Run focused tests and typecheck; expected green.

## Task 2 — common game integration
Produces: selectable strategy and frozen per-ballot views.
Consumes: Task 1 agent factory, existing bootstrap/settings.
- [x] Write a failing same-ballot visibility test; freeze views before sequential calls.
- [x] Integrate strategy with start API and a compact selector; default remains baseline until comparisons are reviewed.
- [x] Run judge/bootstrap/API tests; expected green.

## Task 3 — reproducible experiments
Produces: fixed train/holdout cases, bounded asynchronous experiment API, /lab UI, exportable reports.
Consumes: Task 1 factory and existing browser model configuration.
- [x] Test version-independent fixtures, complete error rows, anonymous judge order and validation, job overlap restriction.
- [x] Implement presets, paired blind scoring, usage/latency accounting, sanitized result storage.
- [x] Run first real train comparison baseline/evidence, inspect outputs and failure modes.
- [x] Implement deliberate version only after findings; rerun train then held-out comparisons.
- [x] Save all reports and a short analysis; expected actual outputs and honest limitations.

## Task 4 — verification and review
- [x] Full tests/typecheck/build, independent code review and necessary fixes.
- [x] Restart local service, verify lab and a live game, choose documented default based on observed results.

## Review focus
1. Information boundaries: malformed references, forged identities, unexpected extra state.
2. Lifecycle: timeout, late completion, cross-seat/game memory, overlapping experiments.
3. Accounting: failed planner/evaluator responses, missing usage, no credential retention.
4. Evaluation validity: failed outputs included, no version labels in scoring, same fixtures and options, holdout leakage.
5. Integration: existing retries, vote ties, invalid strategy, production client/server import boundaries.

## Ledger
- Ruling: keep current checkout on a new feature branch to preserve the running app and all earlier uncommitted changes; do not copy secrets into a worktree.
- Pre-flight: agent factory is shared by bootstrap and experiments; all versions must consume only AgentView. Strategy parsing is separate from LlmConfig. UsagePhase must also update UI labels.

- Task 1: complete — structured planner, grounded references, actual-action memory, 20 s deadline and accounted think calls. Behavioral tests green.
- Task 2: complete — version selector/API integration and frozen ballot snapshots. Full suite 276/276 and typecheck green at 20:59.
- Task 3: round 1 complete — baseline 3.25/4, evidence 3.20/4 on 12 actions each; evidence cost 2.57x tokens. Implemented V2 alternatives/counterfactual checks based on retaliation and missed updates. No holdout feedback used.
- Final review: fixed report recovery (browser RED reproduced; URL restore implemented), expanded runtime manifest, and within-case repetition order (unit RED→GREEN). First report retains its original limited fingerprint; comparisons within each run remain paired.
- Ruling: fixtures are deliberately sparse scripted decision probes, not complete legal game trajectories; no full-game win-rate inference. Semantic truth is judged, not proven by quote validation.

- Task 3: complete — three design comparisons plus frozen holdout; 96 public actions, 211 calls, 245396 reported tokens. All raw reports saved. Holdout baseline 3.25, adaptive 3.13; retain baseline default because no reliable gain.
- Task 4: 283 tests and typecheck pass; independent adaptive review finds no blocker. Shared-deadline second attempt and repair-success tests added. Live adaptive game completed in two rounds; think calls included in billing. Final UI wording rebuild pending.
- Final: minor (deferred): adaptive quote instructions mention text but vote records use reason; no observed blocker and prompts frozen before holdout. Documented for a future measured revision.

- Task 4: complete — final production build passed; server restarted on 127.0.0.1:3000; home/lab HTTP 200; browser shows baseline default and experimental notice. Round 3 and holdout manifest hashes match. No commit or push performed.
