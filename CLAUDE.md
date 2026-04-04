# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A GitHub profile README that displays a live Game of Life simulation as an SVG. The grid evolves every hour via a GitHub Actions workflow, and the README embeds the SVG directly.

## Running the script

```bash
node update.js          # advance one generation
node update.js --seed   # reset to a new random seed
```

There are no dependencies — pure Node.js with no `package.json`.

## How it works

All logic lives in `update.js`. The three output files are committed by the GitHub Action:

- `state.json` — full simulation state (grid, history, seed, colors, shape params)
- `game.svg` — rendered SVG of the current generation
- `README.md` — just embeds the SVG and prints a generation/timestamp stamp

### Simulation

- 40×40 toroidal grid (edges wrap)
- Standard Conway rules (`nextGeneration`)
- `history[y][x]` is an 8-bit shift register: bit 0 = alive last turn, bit 1 = two turns ago, etc. `popcount(history[y][x])` (0–8) drives the cell background color.
- When alive cells drop below `RESEED_THRESHOLD` (80), the script re-seeds automatically using `createSeed`, which places classic methuselah patterns + a Gosper glider gun + 25% random fill, then runs 8 warm-up generations (`WARMUP_TURNS`).

### Rendering

Each cell gets:
1. A background `<rect>` colored by `popcount(history)` — 9 pastel colors from `bgColors`
2. A foreground symbol whose shape depends on the cell's alive-neighbor count in the *new* grid:
   - 0 neighbors → small ellipse
   - 1 neighbor → offset ellipse toward the neighbor
   - 2 neighbors → line segment
   - 3–8 neighbors → distorted polygon with that many sides

Cell status (`surviving` / `dying` / `appearing`) picks among three vivid symbol colors. Shape distortion params and color palettes are generated once at seed time from a deterministic PRNG (`mulberry32`) and stored in `state.json`, so the visual style stays consistent across all generations of one seed.

## GitHub Actions

`.github/workflows/update-readme.yml` runs `node update.js` hourly and commits the three changed files back to `main`.
