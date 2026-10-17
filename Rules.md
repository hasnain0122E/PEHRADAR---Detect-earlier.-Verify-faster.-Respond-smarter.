# PehRadar — Engineering Rules

These rules bind every contributor, human or AI assistant (including Claude Code). When a rule conflicts with speed, the rule wins. If a rule blocks necessary work, record the exception in `Tracker.md` → Decisions with a reason. Do not quietly ignore it.

## 1. Working method
1. **Inspect before editing.** Read the file (and its tests and callers) before changing it. Check the current state of the repo (`git status`) before starting a task.
2. **Never overwrite working code without inspecting it.** No wholesale rewrites of a file you have not read. No regenerating scaffolds over existing directories.
3. **Small, reviewable changes.** One concern per change. Prefer diffs under ~400 lines. Large mechanical changes (e.g. generated types) go in their own commit.
4. **Follow the plan.** Work on the task named in `Tracker.md` → *Next task*. If you discover a better order, update the plan first.
5. **Design API contracts before implementing both sides.** Change `Techspec.md` §3.1 and `Schema.md` first, then the backend, then regenerate `api.gen.ts`, then the frontend.

## 2. Honesty (non-negotiable)
6. **Never fabricate** test results, benchmark numbers, model accuracy, data provenance, model capabilities, live integrations, or deployment status. If something was not run, say "not run". If a test was skipped, report it as skipped.
7. **Run the relevant tests after every change** and report the actual command and its result (pass/fail counts, failures quoted). "Should work" is not a result.
8. **Do not mark a task or milestone DONE until its acceptance criteria are verified.** Record how they were verified (command output, manual steps, date) in `Tracker.md`.
9. **Label simulation.** Simulated cameras, sample incidents, test recipients, and unverified facility data must be labelled in data (`data_source`, `is_simulated`, `is_test`, `verification_status`) and in the UI.
10. **No real-world claims.** Never claim that a station is available, that a route is safe, or that a dispatch occurred. Detection output is decision support, worded as "possible" and "suggested".
11. **No assumed access.** Never write code or copy that implies access to real Karachi CCTV or official emergency systems.

## 3. Scope
12. **Fire/smoke, Karachi only.** Do not build police, ambulance, theft, or vehicle-accident features, or RTSP ingestion, until M10 is DONE and an explicit decision is recorded.
13. **No LLM in the decision path.** An LLM must never be the authoritative fire detector or severity decision-maker.
14. **No LangChain, vector databases, agent frameworks, Redis, Celery, or Kubernetes** without a demonstrated requirement recorded in Tracker → Decisions.
15. **Avoid premature abstraction.** Add an interface only when there are two real implementations (e.g. `Detector`: heuristic + ONNX; notification providers). No plugin registries.

## 4. Code quality
16. **Deterministic core.** Aggregation, dedup, severity, incident state transitions, station ranking and token logic live in `app/domain/` as pure functions with unit tests. No I/O, clock, or randomness inside them (pass `now` and IDs in).
17. **Validate all inputs** at the API boundary (Pydantic, with length and enum limits) and validate files by content, not by name. Return the error envelope with a defined code (`Techspec.md` §3).
18. **Handle errors explicitly.** No bare `except:`. External calls (routing, email, webhook) have timeouts, and their failures are recorded rather than raised to the user as a 500.
19. **Keep UI, API contracts and DB schema consistent.** Enum values and field names are identical across `Schema.md`, SQLAlchemy, Pydantic, and `api.gen.ts`. Never hand-edit `api.gen.ts`.
20. **Timeline is append-only.** No code path updates or deletes `incident_timeline_event` rows.

## 5. Dependencies
21. **Keep dependencies minimal.** Every new dependency needs a one-line justification in the PR/commit message.
22. **Pin dependencies.** Python: `uv.lock` committed, with direct deps constrained in `pyproject.toml`. Web: `package-lock.json` committed, with exact versions for runtime dependencies. Do not upgrade versions incidentally.
23. **No PyTorch in the runtime image.** Inference uses ONNX Runtime. Training or export tooling stays out of `apps/api` runtime dependencies.

## 6. Secrets, data and privacy
24. **Secrets only in environment variables.** Commit `.env.example` with placeholder values. Never commit `.env`, keys, tokens, or real recipient addresses.
25. **Never expose API keys to the browser.** Only `NEXT_PUBLIC_*` values reach the client, and they must be non-secret.
26. **Never commit uploaded footage, `var/`, model weights without a redistributable licence, or personal information.** Check `git status` and the staged diff before every commit.
27. **Never log secrets, ack tokens, or full recipient addresses.** Mask addresses.
28. **No face, person, or licence-plate recognition.** Store the minimum data listed in `Schema.md` §7.
29. **Record provenance for every external dataset, clip, and model** (`samples/SOURCES.md`, `models/README.md`, `data/sources/PROVENANCE.md`): source URL, licence, retrieval date, and hash where applicable.

## 7. Documentation and tracking
30. **Update all affected docs in the same change** as the code that alters behaviour, contracts, schema, or decisions.
31. **Update `Tracker.md` after every task and milestone:** status, verification evidence, new bugs, decisions, and the exact next task.
32. **Decisions marked [INVESTIGATE]** in `Techspec.md` change to [CONFIRMED] only with recorded evidence.

## 8. Git
33. **Commit at stable checkpoints** with meaningful messages (`api: add dedup decision table with unit tests`), not "wip" or "fix".
34. Do not commit failing tests to `main`. If a commit must contain known-failing work, use a branch.
35. No force-pushes to `main`. No rewriting shared history.
