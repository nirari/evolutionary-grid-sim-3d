# Evolutionary Grid Simulation — 3D Isometric

An advanced version of [evolutionary-grid-sim](https://github.com/nirari/evolutionary-grid-sim) with a real-time **isometric 3D bird's-eye view** rendered on an HTML5 Canvas.

## What's new vs the original

| Feature | Original | 3D Isometric |
|---|---|---|
| Rendering | CSS grid / DOM cells | Canvas isometric projection |
| Tree height | Colour only | 3D pillar — height = tree height gene |
| Water channels | CSS class | Animated shimmer tiles |
| Hover info | Side panel | Floating tooltip |
| Performance | DOM mutation per cell | Single canvas redraw per frame |

## Simulation rules (unchanged)

- **4 islands** separated by cross-shaped water channels
- Trees carry a 5-gene genome: growth rate, water efficiency, nutrient efficiency, seed abundance, shade tolerance
- Each generation: consume resources → grow → reproduce → check mortality
- **Migration** moves the fittest trees clockwise between islands at configurable intervals
- Replacement strategy: *Least Fit* or *Random*
- Auto-stop conditions: avg fitness ≥ 100, generation 500, or generation 1000

## Running locally

```bash
# No build step required — plain HTML/CSS/JS
open index.html
# or serve with any static server:
npx serve .
```

## User Interface

Try it here for yourself: https://nirari.github.io/evolutionary-grid-sim-3d/

<img width="1512" height="861" alt="image" src="https://github.com/user-attachments/assets/068c2a7d-df75-4224-9ad3-28606cecba9c" />

