# AI benchmark (local only)

Plays whole games between computer-player policies on your own machine. It
never touches Cloudflare and is not part of `npm test` (it takes minutes).

| policy   | what it is |
|----------|------------|
| `hard`   | the new engine (`src/ai/`), called exactly as the room calls it |
| `legacy` | the hard level before the engine: a verbatim copy of the old `aiBuy` / `aiDraw` / `aiAction` |
| `medium`, `easy` | the unchanged levels |

```bash
# from rami-online/
node tests/bench/run.mjs --a hard --b legacy --pairs 100 --players 2 --seed 1000
node tests/bench/run.mjs --a hard --b medium --pairs 25 --layout ABBB --seed 1000
node tests/bench/selfplay.mjs --games 10 --players 6        # integrity: 6 hard seats, 3 decks
node tests/bench/calibrate.mjs --games 40 --players 4       # opponent threat table
node tests/bench/sweep.mjs '[{"dangerW":0},{"holdMargin":1000}]' --pairs 30   # TUNE variants vs default
```

**Method.** `Math.random` is replaced by a seeded generator for each game, so a
seed fixes the deal, the opener and the reshuffles. Games are played as
duplicates: the same seed once per rotation of the seat layout (`AB` → twice,
`ABBB` → four times), so every side holds every hand. Full games (`mega`, all
six rounds). A side's *win share* is the fraction of games it won (ties
split); parity is 0.5 for `AB`/`ABAB` and 0.25 for one `A` among `ABBB`.
Every step checks card conservation and that the game advances.

## Results (seeds 1000+, not used while tuning)

Measured on the commit that introduced the engine (Node 22, one core per run).

| table | games | new hard: win share | legacy/medium: win share | avg game total per seat (new / old) | avg round penalty (new / old) | rounds won by going out per seat | ants per seat-round (new / old) |
|---|---|---|---|---|---|---|---|
| hard vs legacy, heads-up | 200 | **0.940** | 0.060 | −50.8 / 287.2 | −8.47 / 47.86 | 0.844 / 0.152 | 0.278 / 0.083 |
| 1 hard vs 3 legacy (`ABBB`) | 100 | **0.855** (parity 0.25) | 0.145 | 52.9 / 313.4 | 8.81 / 52.24 | 0.647 / 0.116 | 0.080 / 0.014 |
| 2 hard vs 2 legacy (`ABAB`) | 100 | **0.980** | 0.020 | 111.4 / 376.8 | 18.57 / 62.80 | 0.428 / 0.070 | 0.053 / 0.012 |
| hard vs medium, heads-up | 200 | **0.895** | 0.105 | −37.8 / 188.1 | −6.29 / 31.36 | 0.807 / 0.193 | 0.252 / 0.052 |
| 1 hard vs 3 medium (`ABBB`) | 100 | **0.780** (parity 0.25) | 0.220 | 51.6 / 261.5 | 8.60 / 43.58 | 0.632 / 0.122 | 0.080 / 0.013 |
| *reference:* legacy vs medium, heads-up | 200 | — | legacy 0.250 / medium 0.750 | 270.5 / 179.1 | 45.09 / 29.84 | | |

Lower totals and penalties are better (the game is won on the lowest total; an
ant scores −50). Refused moves: 0 in every run. Card-conservation or deadlock
problems: 0 in every run. Fallbacks (budget ran out, turn finished by the
medium routine): 0 heads-up, 2–6 per 100 four-player games.

The old hard level measured **weaker than medium** (0.25 vs 0.75): its
"hold back when 2–3 cards are spare" ant chase and near-automatic buying cost
more than they won.

**Self-play, 6 hard seats (3 decks), 10 games / 60 rounds:** no problems, no
round reached the deck-exhaustion safety limit, 143 steps per round on average
(medium self-play: 266), 4 fallbacks.

## Decision cost

Wall time per decision in Node (percentiles from 40 heads-up / 40 four-seat games vs medium, seed 2000) (the same V8 the Workers runtime uses);
decisions are bounded by a node budget, not by time (time does not advance
during CPU work on Workers).

| | heads-up | 4 seats |
|---|---|---|
| median | 0.42 ms | 0.76 ms |
| average | 0.9–1.1 ms | 2.6 ms |
| p95 / p99 / p99.9 | 3.8 / 9.1 / 17.4 ms | 12.6 / 20.1 / 30.7 ms |
| worst seen | 100 ms (first decisions, before the JIT warms up) | 88 ms |

Search nodes per decision: take-or-draw avg 2.3k–5.5k, turn 1.0k–2.1k, paid
buy 5.6k–6.7k; the budget caps any decision at 25,000.

A smaller budget plays weaker because more decisions fall back (4 seats,
60 games vs the default engine): 10,000 nodes → win share 0.40, 6,000 → 0.30
(parity 0.50). Heads-up 10,000 is even (0.51). The room reads an optional
`AI_BUDGET` variable to lower it if ever needed.

## Tuning notes

`TUNE` in `src/ai/hard.js`. Variant-vs-default self-play (60–100 games each):
turning off the open-or-wait-for-an-ant lookahead drops the win share to 0.34;
turning off the discard danger term to 0.45; `slotK`, `buyMargin`,
`takeMargin`, `access` within ±50% are flat within noise (±0.05), and
`slotK: 0.9` is clearly worse at four seats. The threat table (`HAZ_*`) comes
from `calibrate.mjs`.
