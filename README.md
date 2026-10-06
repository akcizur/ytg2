# GOTDOPE — Urban Heat 3D

Responsive static-web 3D browser game for GitHub Pages.

## Architecture

- Three.js + Vite
- src/game/Game.js — world, rendering, simulation, missions, traffic, vehicles, weather, save/load
- src/input/InputManager.js — unified input layer
- src/main.js — application wiring and responsive UI
- CSS responsive launcher, HUD, settings and touch controls
- no backend
- no pointer lock
- no extra game-specific dependencies

## Input

Keyboard and mouse:
- Move: WASD / Arrow keys
- Sprint: Shift
- Interact: E
- Fire: Space or left mouse button
- Weather: R
- Pause: Esc
- Aim: mouse
- Keyboard actions can be rebound in INPUT / SETTINGS and are stored in localStorage.

Touch:
- Left stick: movement / steering
- Right stick: aiming
- FIRE: weapon
- ACTION: interact / enter / exit
- SPRINT: sprint
- MENU: pause
- Multitouch allows movement and aiming at the same time.

Gamepad:
- Left stick: move / steering
- Right stick: aim
- RT: fire
- A: interact
- L3: sprint
- Y: weather
- Start: pause
- Standard browser Gamepad API connection events are handled while the game runs.

## Device detection

Keyboard, mouse and touch interactions update the active prompt on meaningful use. Gamepad analog/button activity must pass a dead-zone threshold and a short confirmation window before changing the active input prompt.

## Responsive behavior

- desktop, tablet and mobile HUD
- safe-area insets
- viewport and device-pixel-ratio resize handling
- portrait and landscape touch layout
- touch-action none and pointer capture
- input reset on blur, hidden page and touch cancellation
- page-loss pauses the game and shows an explicit resume screen
- WebGL 2 fallback
- pointer lock is not required

## Gameplay

Implemented:
- procedural monochrome low-poly 3D city
- perspective top-down camera
- player movement and sprint
- drivable vehicles
- traffic and police
- wanted system
- NPCs and gang encounters
- hitscan shooting
- three mission states
- clear, rain, storm and fog weather
- dynamic day/night lighting
- street lights and headlights
- minimap
- localStorage save/load

## Local development

    npm install
    npm run dev

Production:

    npm run build
    npm run preview

## Deployment

GitHub Actions builds dist/ and deploys the Vite output to GitHub Pages. The Vite base path is /ytg2/.

## Low-poly mesh system

The world uses procedural low-poly rules rather than post-process styling:

- flat shading is mandatory for authored meshes;
- hero/world props use chamfered prisms or faceted primitives instead of smooth forms;
- radial geometry is capped at 6–8 segments;
- buildings use a small number of stepped tiers, strong silhouettes and limited facade detail;
- trees use faceted icosahedral crowns;
- vehicles use faceted body/cabin volumes and low-segment wheels;
- NPCs use low-facet capsules and icosahedral heads;
- emissive accents are reserved for windows, lamps and mission-readable elements;
- detail is concentrated on silhouette, large planes and readable color blocks;
- no high-density subdivision is used for gameplay meshes.

### Bundled free 3D models

The static build now bundles CC0 Kenney models for buildings, vehicles, street lights and trees. They are loaded from `public/assets/models/kenney/` and recolored through the game's low-poly style system, with procedural geometry retained as the initial/fallback layer.
