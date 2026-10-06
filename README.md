# YTG2 — Urban Heat

Static top-down urban action game designed for GitHub Pages.

## Run locally

No package manager or backend is required.

\`\`\`text
Open index.html in a local static server.
\`\`\`

A simple option:

\`\`\`bash
python -m http.server 8080
\`\`\`

Then open \`http://localhost:8080/\`.

## Controls

- WASD / Arrow keys — movement / driving
- Shift — sprint on foot
- E — enter/exit vehicle, start mission
- Space / left mouse — shoot
- ESC — pause
- Save Now — localStorage save

## Gameplay

Three repeatable-style missions form the initial campaign slice:

1. Night Courier — deliver and return.
2. Hot Vehicle — steal the marked car, lose wanted level, reach garage.
3. Clean Street — eliminate six gang targets and return to market.

Systems included:

- procedural city map
- buildings, roads and parks
- top-down camera with vehicle lead
- foot movement and sprint
- drivable vehicles
- police vehicles and wanted system
- NPC civilians and gang enemies
- shooting and collision
- mission markers
- minimap
- cash, score, health and stamina
- local save
- procedural sound effects
- GitHub Pages deployment workflow

No proprietary GTA assets are included.
