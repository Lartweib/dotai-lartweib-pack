# Autonomous work: ingredients

Version 1, dated 2026-11-02. Checked against: Claude Opus 5.5 and Sonnet 5.5 (Claude Code), Gemini 3.8 (agy). Source: pack DESIGN §6 and 0013.

Each ingredient encodes an assumption about the model. Re-evaluate the list with every new model generation; when one changes, bump the version and date and say what moved.

| Ingredient | Solves | Skip if |
|---|---|---|
| Phases: understand, design, milestones, verify | Coding before understanding | Mechanical or already understood task |
| Measurable success criterion: end state, check, constraints (required) | The work can stop and someone else can verify it | Never |
| Milestones verifiable on their own, each with its command | Progress with evidence; resuming | Single-step task |
| Work list with status (JSON `passes` field or a checklist) | "Done" declared too early | Fewer than ~5 items |
| Progress and decisions file (`STATUS.md`, `HANDOFF.md`) | Fresh context per item without losing the thread | One short session |
| One item per fresh context | Noise builds up | Items depend heavily on each other |
| Round and turn caps, quota cap from config (required; the caps are in the skill) | Loops and cost | Never |
| Fresh-context verification (a separate verifier) | Self-evaluation is lenient | The check is fully deterministic |
| Evaluator calibration: try it on a known-bad case first | An uncalibrated evaluator approves broken work (agy failed 73% of trials as a visual judge: pack measurement, 0044 update) | The check is a script |
| Pilot on one slice | Measures the cost before committing | Cheap runs |
| Human review between runs | A workflow cannot ask questions | No human decisions left |

## Verifier

- The `/goal` evaluator executes nothing; it judges only what was shown. The condition must ask for the check's output to be shown.
- If the app has to run to verify, use a verifier with tools (`reviewer`, or `worker` to capture and `reviewer` to read).
