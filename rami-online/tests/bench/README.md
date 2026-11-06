# AI benchmark and production checks (local only)

Plays whole games between computer-player policies on your own machine. It
never touches Cloudflare and is not part of `npm test` (it takes minutes).

| policy   | what it is |
|----------|------------|
| `hard`   | the new engine (`src/ai/`), called exactly as the room calls it (a failed turn finishes with the medium routine, as in the room) |
| `hard@<dir>` | the engine loaded from another copy of `src/ai` (e.g. an older commit in a scratch folder), for before/after runs |
| `legacy` | the hard level before the engine: a verbatim copy of the old `aiBuy` / `aiDraw` / `aiAction` |
| `medium`, `easy` | the unchanged levels |

```bash
# from rami-online/
node tests/bench/run.mjs --a hard --b medium --pairs 100 --players 2 --seed 210000   # duel, with 95% CIs
node tests/bench/run.mjs --a hard --b medium --pairs 25 --layout ABBB --seed 230000  # 1 vs 3, every rotation
node tests/bench/stress.mjs --seeds 25 --seed0 300000   # 2–6 seats: integrity + fairness + plan fidelity
node tests/bench/bighands.mjs --cases 600              # 18–34-card hands, many jokers, big boards
node tests/bench/cpu.mjs --players 6 --games 8 --warm 30   # CPU per decision and per AI chain
node tests/bench/coldstart.mjs --seed 1                # first decisions in a fresh process (JIT cold)
node tests/bench/selfplay.mjs --games 10 --players 6
node tests/bench/calibrate.mjs --games 40 --players 4  # opponent threat table
node tests/bench/sweep.mjs '[{"dangerW":0}]' --pairs 30   # TUNE variants vs default
```

## Method

`Math.random` is replaced by a seeded generator for each game, so a seed fixes
the deal, the opener and the reshuffles. Each seed is played once per
rotation of the seat layout (`AB` → twice, `ABBB` → four times): every side
holds every hand in every chair. Full games (`mega`, six rounds). *Win share*
is the fraction of games a side won (ties split); parity is 0.5 for `AB` /
`ABAB` and 1/n for one `A` among n seats. Every step checks card conservation
and that the game advances.

**Confidence intervals** are 95%, by block bootstrap over seeds (2,000
resamples; a seed's rotations share a deal, so they are resampled together).
`totalDiff` is the hard side's average game total minus the other side's, per
seat (negative = hard scores better).

**Information.** The engine sanitizes the state before every decision (it
never sees hidden cards — `stress.mjs` checks this). The old policies receive
the full state but only read their own hand and the board, as they did in the
room. **Sanity checks:** hard vs hard gives exactly 0.500 (the harness has no
seat or order advantage); legacy vs medium reproduces 0.258 / 0.743.

## Results

Fresh seeds (200000+), never used while developing or tuning, on the final
code of the review (Node 22).

| table | games | new hard win share [95% CI] | parity | game total per seat, hard − other [95% CI] | round penalty (hard / other) | rounds won by going out per seat (hard / other) |
|---|---|---|---|---|---|---|
| vs legacy, 2 seats | 200 | **0.905** [0.86, 0.945] | 0.5 | −285 [−309, −259] | −6.1 / 41.4 | 0.78 / 0.21 |
| vs medium, 2 seats | 200 | **0.960** [0.93, 0.98] | 0.5 | −236 [−258, −213] | −6.9 / 32.4 | 0.81 / 0.19 |
| 1 vs 2 medium | 90 | **0.889** [0.82, 0.96] | 0.33 | −244 [−277, −212] | 0.4 / 41.1 | 0.75 / 0.13 |
| 1 vs 3 legacy | 100 | **0.810** [0.74, 0.87] | 0.25 | −279 [−304, −253] | 8.6 / 55.0 | 0.65 / 0.12 |
| 1 vs 3 medium | 100 | **0.890** [0.84, 0.94] | 0.25 | −252 [−274, −230] | 4.6 / 46.7 | 0.67 / 0.11 |
| 1 vs 4 medium | 75 | **0.840** [0.77, 0.91] | 0.2 | −247 [−276, −218] | 10.7 / 51.9 | 0.61 / 0.10 |
| 1 vs 5 medium | 60 | **0.783** [0.70, 0.87] | 0.167 | −216 [−249, −186] | 19.6 / 55.6 | 0.55 / 0.09 |
| *reference:* legacy vs medium | 200 | legacy 0.258 [0.20, 0.32] | 0.5 | +87 [+70, +105] | 44.6 / 30.1 | |
| review engine vs pre-review engine, 2 seats | 200 | 0.505 [0.50, 0.515] | 0.5 | −1.6 [−5.6, +1.2] | 13.0 / 13.3 | |
| review engine vs pre-review engine, 2 vs 2 | 100 | 0.540 [0.50, 0.60] | 0.5 | −2.8 [−13.6, +6.8] | 31.7 / 32.2 | |

Lower totals are better (the lowest total wins the game; an ant scores −50).
Refused moves: 0 in every run; card-conservation or deadlock problems: 0.
Fallbacks (turn out of budget, finished by the medium routine): 0 heads-up,
3–10 per 100 games at 3–6 seats.

**Corrections to the first report.** The PR's first numbers (seeds 1000+)
were single point estimates without intervals. On fresh seeds: vs legacy
heads-up 0.905 (first report 0.94, inside this run's interval), vs
medium heads-up 0.96 (was 0.895), 1 vs 3 legacy 0.81 (was 0.855), 1 vs 3
medium 0.89 (was 0.78). The conclusion stands; individual figures move by
±0.1 between seed sets, which is why they are now given with intervals.

The old hard level is **weaker than medium** (0.258 [0.20, 0.32] heads-up).

**Known weakness:** in heads-up late rounds (runs of five) an opened hard
player can be left with a few cards the thin board can't take, and the round
runs to the 50-turns-per-player safety limit (2 of 918 stress rounds; it was
still ahead in both).

## Integrity, fairness, fidelity (`stress.mjs`, `bighands.mjs`)

- 225 games at 2–6 seats (mixed hard / medium / easy / legacy, 918 rounds),
  seeds 300000+: 0 integrity problems (cards conserved after every step, every
  step advances, no step limit), 0 refused moves.
- **Fairness:** at 8,373 sampled hard decisions every hidden card (opponents'
  hands and the deck, sizes kept) was dealt again at random: the decision was
  identical every time (out-of-budget included).
- **Fidelity:** at 2,237 sampled turns the plan the engine made on its public
  copy was played on the real state: same hand, board and phase every time.
- 600 extreme positions (18–34 cards, up to 6 jokers, up to 14 board groups,
  every phase) through the room's code paths: every move legal, cards
  conserved, every turn ended, no engine error.
- Easy and medium are unchanged: 40 full seeded games (2–6 seats) through the
  original room from `main` and the current one gave identical scores round by
  round and the same number of steps.

## CPU

CPU time (`process.cpuUsage`, user + system), not wall time, in Node 22 (the
V8 the Workers runtime uses). Warm figures leave out each process's first 30
decisions; the cold cost is measured separately.

**Per AI chain** — every computer move between two moves of the one human at
the table, including the room's state serialization and the update sent to
the human. That is the work following one incoming WebSocket message.

| table (1 human + bots) | p50 | p95 | p99 | max | chains > 10 ms |
|---|---|---|---|---|---|
| 2 seats, hard | 1.9 ms | 9.4 | 15.9 | 26 | 4% |
| 4 seats, hard | 4.7 ms | 24.9 | 44.2 | 114 | 25% |
| 6 seats, hard | 8.4 ms | 38.0 | 58.3 | 97 | 43% |
| 6 seats, medium (before) | 1.5 ms | 5.2 | 8.7 | 17.5 | 0.7% |

**Per decision**, 6 seats: turn p50 1.3 / p95 6.1 / p99 9.7 / max 21 ms;
take-or-buy p50 0.7 / p95 9.3 / p99 14.8 / max 53 ms; draw p50 0.1 ms.

**Cold start:** the first take decision in a fresh process costs 33–74 ms CPU
(6 runs), the second 25–53 ms, from the fourth on 3–10 ms — the JIT warming
up. A Durable Object isolate pays it once when it starts (a game's first
decisions, or after an eviction).

**Extreme hands** (18–34 cards): turn p50 5.9 / p95 15.7 / max 32 ms;
take-or-buy p50 6.8 / p95 17 / max 104 ms. Half of these decisions run out of
budget and fall back; a hand over 20 cards gets a smaller budget
((20/size)² of the default), so it falls back sooner instead of spending
CPU first.

**The budget is a node count, not a CPU limit** (time can't be read during
CPU work on Workers, so a time limit isn't possible). Solver work runs at
~0.6 µs per node once warm, but CPU outside the solver and JIT state vary, so
treat the figures above as the measured envelope.

**Smaller budgets cost strength** (4 seats, vs the default engine, 60 games):
10,000 nodes → win share 0.40, 6,000 → 0.30. The default stays 25,000; the
room reads an optional `AI_BUDGET` variable to lower it.

**What the review changed** (identical decisions unless noted): the memo is an
open-addressing table of Int32 keys instead of a `Map` (−30% solver CPU on big
hands); board attach flags test only the suits and values a group holds and
are cached per board (verified identical over 3,000 random boards); a paid buy
is only averaged over the penalty card when the card alone comes within 3
points of paying off (changes ~0.4% of paid-buy decisions; strength unchanged
per the table above). Like for like — both engines in the same games (the
"review vs pre-review" duels; wall time per decision): heads-up p50 0.56 →
0.44 ms, p99 13.7 → 9.6 ms; 2 vs 2 p50 1.19 → 0.63 ms, p99 21.9 → 13.6 ms.

## Storage writes per game

Every move (human or computer) saves the room: one row written. A 4-seat game
(1 human + 3 bots) took 581 steps with hard bots, 1,249 with medium, 1,226
with legacy (8 seeded games each) — hard bots finish rounds in about half
the moves.

## Tuning notes

`TUNE` in `src/ai/hard.js`. Variant-vs-default self-play (60–100 games each):
turning off the open-or-wait-for-an-ant lookahead drops the win share to 0.34;
turning off the discard danger term to 0.45; `slotK`, `buyMargin`,
`takeMargin`, `access` within ±50% are flat within noise (±0.05), and
`slotK: 0.9` is clearly worse at four seats. The threat table (`HAZ_*`) comes
from `calibrate.mjs`.
