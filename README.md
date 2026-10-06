# YTG2 — Urban Heat 3D

Modern 3D top-down urban action game for GitHub Pages.

## Stack
- Three.js 0.186.1
- Vite 8.3.3
- WebGL 2
- PBR-style MeshStandard / MeshPhysical materials
- procedural asphalt, concrete, roof and ground textures
- bump maps and emissive window textures
- dynamic sun, street lights, headlights and police lights
- Unreal Bloom post-processing
- custom GLSL rain shader
- weather cycle: clear / rain / storm / fog
- procedural 3D city, traffic and NPCs
- localStorage save
- no backend
- no Vercel

## Controls
- WASD — move / drive
- Shift — sprint
- E — enter/exit vehicle / interact
- Space / left mouse — fire
- R — change weather
- Esc — pause

The visual direction is a modernized GTA III-inspired top-down camera: real 3D buildings, perspective depth, PBR-style surfaces, emissive windows and dynamic weather while keeping a lightweight static-web architecture.

## GitHub Pages
Vite is configured with `base: '/ytg2/'` and the included workflow builds `dist/` before deploying it to GitHub Pages.
