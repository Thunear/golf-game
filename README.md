# Designsystemet golf

Browser multiplayer minigolf inspired by *Golf With Your Friends*. The UI is in Norwegian
(bokmål). One person creates a room, shares the 4-letter code (or invite link), and everyone
plays the same hole at the same time. Balls don't collide with each other, so nobody can block you.

- **Client**: Three.js rendering, cannon-es physics (each player simulates their own ball),
  procedurally generated textures (no asset downloads), synthesized sound effects.
- **Server**: Node + Express + Socket.IO. Owns rooms, hole progression, timers and scores;
  relays ball positions between players.
- **Course**: "Lysningen", 9 holes with log borders, ramps, a windmill you putt through,
  hollow-log tunnels, sliding gates, water and bumpers. The greens themselves stay clean.
  The course follows the Designsystemet story "Fra idé til lansering": quiz gates about the
  design system, Buttons you roll over to open gates, Card panels, Switch gates and a logo
  flag on the finale. See `docs/LEVELS.md`.

**Play it:** https://designsystemet-golf.onrender.com/ (Render free tier; the first visit
after a quiet spell takes about half a minute while the server wakes up).

## Running it

```bash
npm install
npm run dev        # server on :3000 + Vite dev server on :5173 (open http://localhost:5173)
```

Production build (single process serving the built client):

```bash
npm run build
npm start          # http://localhost:3000  (set PORT to change)
```

## Deploying

The game has two parts: a static client (Vite build in `dist/`) and a Node game server
(Express + Socket.IO). The server needs a long-running process with WebSocket support, which
**Netlify does not offer**, so there are two ways to go live:

**Option A – one host for everything (simplest).** Deploy the repo to a Node host such as
Render, Railway or Fly.io. The server serves the built client itself, so one URL is the game.
A `render.yaml` blueprint is included, so on Render this is one click:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Thunear/golf-game)

(or *New → Blueprint* in the Render dashboard and pick the repo). It builds with
`npm ci && npm run build`, starts with `npm start`, and Render sets `PORT` itself. The free
tier sleeps when idle, so the first player of the evening waits about half a minute while it
wakes up; every push to `main` redeploys automatically.

**Option B – client on Netlify, server elsewhere.** Deploy the server as in option A and note
its URL. Then on Netlify: *Add new site → Import from Git*, pick the repo (the included
`netlify.toml` sets the build command and publish directory), and add the environment variable
`VITE_SERVER_URL=https://<your-server>` before the first build. The client will open its
Socket.IO connection to that URL (the server already allows any origin). Invite links
(`?room=ABCD`) work because `netlify.toml` routes every path to `index.html`.

For a quick session without deploying, expose your local server with a tunnel such as
`cloudflared` or `ngrok` and share that URL.

## Controls

| Action | Input |
| --- | --- |
| Aim + putt | Left-drag from your ball, pull back, release |
| Rotate camera | Left-drag anywhere else, or `A`/`D` / arrow keys |
| Tilt camera | `Q` / `E` |
| Zoom | Scroll wheel, or `W`/`S` |
| Cancel a shot | `Esc` while aiming |
| Mute | `M` |

## Rules

- The host picks the starting hole and how many holes to play (up to the end of the course).
- Everyone plays simultaneously. A hole ends when everyone has finished or after 3 minutes.
- Stroke limit is 12 per hole. Water and out-of-bounds cost one stroke and put you back where you shot from.
- Scoreboard after each hole; final standings at the end. The host can replay or return to the lobby.
- People can join a room mid-game; they simply start on the current hole.

## Project layout

```
server/index.js          Express + Socket.IO bootstrap, serves dist/ in production
server/rooms.js          Rooms, players, hole flow, scoring
client/src/main.js       Wires network events to the game and UI
client/src/game.js       Renderer, physics world, ball, camera, input
client/src/course/holes.js    Course data (add or edit holes here)
client/src/course/builder.js  Builds meshes + physics bodies from hole data
client/src/textures.js   Canvas-generated grass/wood/sand/bumper textures
client/src/materials.js  Shared Three.js materials and physics contact materials
client/src/ui.js         Lobby, room, HUD, scoreboard, toasts
client/src/audio.js      WebAudio sound effects
```

## Adding a hole

Holes are plain data in `client/src/course/holes.js`. Each hole has a name, par, tee and
cup position, and a list of pieces built from small helpers:

```js
{
  name: 'My Hole', par: 3,
  tee: [0, 0, 8], cup: [0, 0, -8],
  pieces: [
    floor(0, 0, 4, 20),                 // x, z, width, depth
    outline(rect(-2, -10, 2, 10)),      // walls around the edge
    ramp(0, 0, 4, 4, 1, 'n'),           // slope rising towards -z
    bumper(1, -4, { r: 0.35 }),
    bumper(-1, -4, { r: 0.3, color: 'blue' }), // painted post (logo colour name or CSS colour)
    plaque(0, 2, 'Card', { y: 0 }),     // small board nailed to the nearest wall, facing (x, z)
    button(0, -2, { label: 'Åpne porten', opens: 'port' }), // Designsystemet Button pad; roll over to click
    gate(-2, -6, -2, -2, { id: 'port' }),   // wooden gate that sinks into the floor when its button is clicked
    card(0, -9, 's', { title: 'Komponenter', lines: ['…'], button: 'Åpne porten' }), // standing Card panel
    post(1, 2),                          // single stump, e.g. to frame a gate
    windmill(0, 0, 'n', { sailColors: ['red', 'yellow', 'blue', 'grey'] }), // logo-coloured sails
    slider(0, 2, 1.6, 0.4, 'x', 1.6, 1.6, { look: 'switch' }),           // giant Switch as a moving gate
    tunnel(0, 4, 3, 'n', { r: 0.6 }),   // hollow log to roll through
    windmill(0, -4, 'n', { speed: 1.3 }), // mill house with blades sweeping the doorway
    chute(0, 1.5, 0, 0, 0, -6),         // sloped tunnel between two floor levels
    quiz(0, 0, 'n', { question, answers: ['A', 'B', 'C'], correct: 0 }), // three-way quiz gate
  ],
}
```

See `docs/LEVELS.md` for the course plan, the story arc and the quiz mechanic.

Walls are drawn as logs but collide as boxes, so you can place `wall(...)` segments freely
inside a hole to make slaloms. Rocks, bushes and the "HOLE n" sign are scattered
automatically around each hole.

Coordinates: `x` east, `z` south (towards the default camera), `y` up. Set `y` on floors
and on outline corners to build raised sections. See the comment block at the top of
`holes.js` for every piece type.

## Performance notes

Shadows use a single 2048 px shadow map fitted to the current hole, pixel ratio is capped at
1.5, and every mesh shares a handful of materials, so integrated laptop GPUs handle it fine.
