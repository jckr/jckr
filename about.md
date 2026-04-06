# How this image works

The image at the top of this page is a live simulation. It updates every hour, automatically, and it has never looked quite this way before and never will again.

## What you're looking at

It's a 40×40 grid running [Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life) — a classic cellular automaton where cells live and die according to simple rules based on how many neighbors they have:

- A live cell with 2 or 3 live neighbors **survives**
- A live cell with any other number of neighbors **dies**
- A dead cell with exactly 3 live neighbors **comes to life**

That's it. Those three rules, applied simultaneously to every cell, every hour, produce everything you see.

The grid wraps around at the edges — cells on the left border are neighbors of cells on the right, and the top connects to the bottom. This is called a toroidal topology, and it means the simulation has no walls or edges to distort the patterns.

## What the colors mean

### Background color

Each cell's background encodes its **recent history** — specifically, how many of the past 8 hours it was alive. A cell that has been alive for all 8 of the last 8 hours gets the darkest shade; a cell that's been dead the whole time gets the lightest. The 9 possible states (0 through 8 hours of recent life) map to 9 colors that together form the background gradient you see.

This means color acts like a heatmap of activity over time, not just right now. Regions that have been busy — where life keeps cycling through — show up in richer, deeper tones. Long-dead regions fade to the palest shade.

### Symbol shapes

Live cells are drawn with a symbol whose **shape depends on how many live neighbors the cell has** in the current generation:

| Neighbors | Shape |
|---|---|
| 0 | Small ellipse |
| 1 | Offset ellipse, leaning toward its neighbor |
| 2 | Line segment |
| 3 | Triangle |
| 4 | Quadrilateral |
| 5–8 | Pentagon through octagon |

So a lone isolated cell looks like a tiny dot, while a dense cluster shows as a collection of pentagons and hexagons packed together.

### Symbol colors

Each symbol has one of three colors depending on what's happening to that cell this generation:

- **Surviving** — the cell was alive and will remain alive (2 or 3 neighbors)
- **Appearing** — the cell was dead and is coming to life (exactly 3 neighbors), drawn as a hollow outline
- **Dying** — the cell is alive but has the wrong number of neighbors and won't survive

The three colors are chosen once when a new simulation starts, spread 120° apart on the color wheel for contrast, and stay consistent until a reset.

## How the palette is chosen

Every time the simulation starts fresh, a new random color palette is generated. The 9 background shades are pastel tones spread around the color wheel. The 3 symbol colors are vivid, well-separated hues — automatically adjusted until they have sufficient contrast against all 9 background colors.

All shape distortions (the slight irregularity of the polygons and ellipses) are also randomized once at the start and held constant, so the visual style stays coherent across all hours of a given simulation run.

## How the rendering works

Each cell is painted as a slightly rotated, slightly oversized rectangle with a small random lightness variation. The rotation (up to ±9°) and size (108–122% of nominal) are deterministic — the same cell always gets the same treatment within a given simulation run — but they vary from cell to cell, so the background has a handmade, mosaic quality rather than looking like a rigid pixel grid. Cells are drawn in a shuffled order so the overlapping edges between them mix in all directions.

Symbols are drawn on top using the Canvas 2D API with anti-aliasing. Polygons use pre-computed vertex distortions (also fixed per simulation run) that make each shape slightly irregular.

## Starting conditions

Each new simulation begins by placing several classic long-lived patterns at fixed locations on the grid:

- Three **R-pentominoes** and one **Acorn** — small shapes that take hundreds of generations to fully stabilize
- A **Rabbits** pattern — another slow-burning methuselah
- A **Gosper Glider Gun** — a structure that continuously fires gliders across the grid

On top of these, roughly 25% of the remaining cells are randomly seeded. The simulation then runs for 8 warm-up generations before the first image is saved, giving the initial chaos time to organize into something interesting.

## Automatic resets

If the simulation runs out of steam — fewer than 80 of the 1,600 cells remain alive — it reseeds automatically with a new random palette and fresh starting patterns. This prevents the image from going dark.

## How it updates

A GitHub Actions workflow runs every hour. It loads the saved simulation state, computes one generation of Game of Life, renders the new image, and commits the result back to the repository. The README displays the latest image, so anyone visiting this profile sees the current state of the simulation.

The iteration number and timestamp in the caption below the image show how long this particular simulation has been running.
