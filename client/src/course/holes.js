// Course definition. Coordinates: x = east, z = south (towards the default
// camera), y = up. Each hole is built at the origin when it is played.
//
// Piece types:
//   floor(x, z, w, d, {y, mat: 'grass'|'water', walls: 'nsew'})
//   outline([[x, z, y?], ...])          closed loop of log walls (y per corner; sloped when they differ)
//   wall(x1, z1, x2, z2, {y1, y2, h})   single log wall segment
//   ramp(x, z, w, len, rise, dir)       slope that rises towards dir ('n' = -z, 's' = +z, 'e' = +x, 'w' = -x)
//   bumper(x, z, {r, h, y, color})      bouncy post; `color` paints it (CSS colour or logo colour name)
//   plaque(x, z, text, {y, w, bg, fg})  small board nailed to the wall nearest (x, z) at level y, facing (x, z)
//   button(x, z, {y, w, d, label, opens, color, message})  Designsystemet Button pad on the green; rolling
//                                        over it opens the gate(s) with id `opens`
//   gate(x1, z1, x2, z2, {y, id, h})    wooden gate across a lane that sinks into the floor when opened
//   card(x, z, dir, {y, w, h, title, lines, button, tilt, base})  standing Card panel facing `dir`
//   post(x, z, {y})                     single vertical stump (e.g. to frame a gate)
//
// Hole options: `intro` (story line under the hole toast), `flag: {scale, logoOnly}`.
// Windmill: `sailColors: ['red','yellow','blue','grey']`. Slider: `look: 'switch'` draws a
// Designsystemet Switch (white thumb on a blue track).
//   spinner(x, z, len, speed, {y})      rotating bar
//   slider(x, z, w, d, axis, amp, speed, {phase, y, h})  block moving back and forth
//   box(x, z, w, h, d, {y, rotY})       static wooden block
//   tunnel(x, z, len, dir, {r, y})      hollow log to roll through, axis along dir
//   windmill(x, z, dir, {speed, width, passage, y})  mill house you putt through; blades sweep the door
//   quiz(x, z, dir, {width, question, answers: [a, b, c], correct})  question board + log wall with
//                                        three openings; going through the right one is the fast route
//   chute(x1, y1, z1, x2, y2, z2, {r})  sloped tunnel between two floor levels (y = floor at each end)
//   hill({seed, regions: [{min, max, n, radius, grassAbove}], avoid: [[min, max], ...]})
//                                        clustered boulders that stay out of the avoid boxes and chutes
//
// Design rule for this course: keep the green itself clean. Obstacles are things
// you go through, around or over, never bumps or sand on the putting surface.

const floor = (x, z, w, d, o = {}) => ({ type: 'floor', x, z, w, d, ...o });
const outline = (pts, o = {}) => ({ type: 'outline', pts, ...o });
const wall = (x1, z1, x2, z2, o = {}) => ({ type: 'wall', x1, z1, x2, z2, ...o });
const ramp = (x, z, w, len, rise, dir, o = {}) => ({ type: 'ramp', x, z, w, len, rise, dir, ...o });
const bumper = (x, z, o = {}) => ({ type: 'bumper', x, z, ...o });
const spinner = (x, z, len, speed, o = {}) => ({ type: 'spinner', x, z, len, speed, ...o });
const slider = (x, z, w, d, axis, amp, speed, o = {}) => ({ type: 'slider', x, z, w, d, axis, amp, speed, ...o });
const box = (x, z, w, h, d, o = {}) => ({ type: 'box', x, z, w, h, d, ...o });
const tunnel = (x, z, len, dir, o = {}) => ({ type: 'tunnel', x, z, len, dir, ...o });
const windmill = (x, z, dir, o = {}) => ({ type: 'windmill', x, z, dir, ...o });
const quiz = (x, z, dir, o = {}) => ({ type: 'quiz', x, z, dir, ...o });
const chute = (x1, y1, z1, x2, y2, z2, o = {}) => ({ type: 'chute', x1, y1, z1, x2, y2, z2, ...o });
const hill = (o) => ({ type: 'hill', ...o });
const plaque = (x, z, text, o = {}) => ({ type: 'plaque', x, z, text, ...o });
const button = (x, z, o = {}) => ({ type: 'button', x, z, ...o });
const gate = (x1, z1, x2, z2, o = {}) => ({ type: 'gate', x1, z1, x2, z2, ...o });
const card = (x, z, dir, o = {}) => ({ type: 'card', x, z, dir, ...o });
const post = (x, z, o = {}) => ({ type: 'post', x, z, ...o });
const rect = (x1, z1, x2, z2) => [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];

export const COURSE = {
  id: 'skogen',
  name: 'Lysningen',
  holes: [
    {
      // A gentle Z: up the first lane, across, then up to the cup. Nothing on the green.
      name: 'Første slag',
      par: 3,
      intro: 'Alt starter med en skisse. Slå løs!',
      tee: [0, 0, 10],
      cup: [6, 0, -6],
      pieces: [
        floor(0, 8, 4, 8),
        floor(3, 2, 10, 4),
        floor(6, -4, 4, 8),
        outline([[-2, 12], [2, 12], [2, 4], [8, 4], [8, -8], [4, -8], [4, 0], [-2, 0]]),
        card(6, -9.3, 's', {
          y: 2.1,
          title: 'Kom i gang',
          lines: ['Designsystemet hjelper deg å lage', 'gode digitale tjenester.', 'Alt starter med en skisse. Slå løs!'],
        }),
      ],
    },
    {
      // "Tokens". Two storeys: the tee sits on a plateau 1.5 m up. Three tunnel mouths in
      // a rock face carry the ball down through the hill to the lower green. You can't
      // see where they go: A (correct) exits straight in line with the cup, B drifts
      // right, C comes out far right.
      name: 'Tre porter',
      par: 3,
      intro: 'Bli enige om språket først. Velg riktig port.',
      tee: [0, 1.5, 9],
      cup: [-2.6, 0, -11],
      pieces: [
        // Upper plateau
        floor(0, 7.5, 4, 7, { y: 1.5 }),
        floor(0, 2, 8, 4, { y: 1.5 }),
        outline([[-4, 0, 1.5], [-4, 4, 1.5], [-2, 4, 1.5], [-2, 11, 1.5], [2, 11, 1.5], [2, 4, 1.5], [4, 4, 1.5], [4, 0, 1.5]], { open: true }),
        quiz(0, 0, 'n', {
          y: 1.5,
          width: 8,
          question: 'Hva heter de delte variablene for farger, avstander og typografi i Designsystemet?',
          answers: ['Tokens', 'Snippets', 'Pixels'],
          correct: 0,
        }),
        // Short floor pads behind the mouths, then the tunnels down through the hill.
        // Chutes start behind the wall plane so an angled ring never blocks its own mouth.
        floor(-2.6, -0.3, 1.3, 0.6, { y: 1.5 }),
        floor(0, -0.3, 1.3, 0.6, { y: 1.5 }),
        floor(2.6, -0.3, 1.3, 0.6, { y: 1.5 }),
        chute(-2.6, 1.5, -0.4, -2.6, 0, -6.3),
        chute(0, 1.5, -0.4, 2.2, 0, -6.3),
        chute(2.6, 1.5, -0.4, 6.8, 0, -6.3),
        // Lower green, open towards the hill except for retaining logs between the exits
        floor(2, -9.25, 14, 7.5),
        outline([[-5, -5.5], [-5, -13], [9, -13], [9, -5.5]], { open: true }),
        // Gaps are wider under the angled chutes, whose mouths are wider in plan.
        wall(-5, -5.5, -3.6, -5.5),
        wall(-1.6, -5.5, 1.1, -5.5),
        wall(3.3, -5.5, 5.4, -5.5),
        wall(8.2, -5.5, 9, -5.5),
        // The hill itself
        hill({
          seed: 7,
          regions: [
            { min: [-5.5, -1.0, -5.2], max: [9.5, 4.2, 0.4], n: 160, radius: [0.7, 1.7], grassAbove: 2.4 },
            { min: [-6.5, -1.0, -0.5], max: [6.5, 1.3, 9], n: 80, radius: [0.6, 1.3], grassAbove: 0.6 },
            // Low boulders hiding the plateau skirt at the tee end (kept below the plaque).
            { min: [-3.2, -1.0, 11.2], max: [3.2, 0.4, 12.8], n: 14, radius: [0.6, 1.0] },
          ],
          avoid: [
            [[-4.3, -5, -0.7], [4.3, 9, 4.3]],
            [[-2.3, -5, 4], [2.3, 9, 11.6]],
            [[-5.3, -5, -13.3], [9.3, 9, -5.4]],
          ],
        }),
      ],
    },
    {
      // "Komponenter". A U-shaped hole one storey up and back down. Up the ramp onto
      // the plateau, where a big blue Designsystemet Button lies on the green: roll
      // over it to "click" it and the wooden gate on the left sinks into the floor.
      // Through the gate, down the second ramp, and along the lower lane to the cup,
      // which sits next to the tee lane so you see the flag from the start. A Card
      // panel behind the plateau explains the mechanic.
      name: 'Stigningen',
      par: 4,
      intro: 'Første komponent: trykk på knappen for å åpne porten.',
      tee: [0, 0, 13],
      cup: [-8.5, 0, 10.5],
      pieces: [
        // Tee lane, ramp up, plateau corridor
        floor(0, 10, 4, 10),
        ramp(0, 3, 4, 4, 1, 'n'),
        floor(0, -3, 4, 8, { y: 1 }),
        button(0, -3.4, { y: 1, w: 1.7, d: 1.1, label: 'Åpne porten', opens: 'port' }),
        card(0, -8.1, 's', {
          y: 2.45, w: 2.8, h: 1.7,
          title: 'Komponenter',
          lines: ['Byggeklossene i Designsystemet.', 'Rull over knappen på plenen', 'for å åpne porten til venstre.'],
          button: 'Åpne porten',
        }),
        // West wing behind the gate, ramp back down, lower lane and cup room
        floor(-5, -5, 6, 4, { y: 1 }),
        gate(-2, -7, -2, -3, { y: 1, id: 'port' }),
        ramp(-6, -1, 4, 4, 1, 'n'),
        floor(-6, 4, 4, 6),
        floor(-7, 10, 6, 6),
        outline([
          [-2, 15, 0], [2, 15, 0], [2, 5, 0], [2, 1, 1], [2, -7, 1], [-8, -7, 1], [-8, -3, 1], [-8, 1, 0],
          [-8, 7, 0], [-10, 7, 0], [-10, 13, 0], [-4, 13, 0], [-4, 7, 0], [-4, 1, 0], [-4, -3, 1],
          [-2, -3, 1], [-2, 1, 1], [-2, 5, 0],
        ]),
      ],
    },
    {
      // "Iterasjon". A 20 m lane through the mill, whose four sails carry the four
      // logo colours, then a dogleg right into the cup room. Timing is the lesson.
      name: 'Vindmølla',
      par: 3,
      intro: 'Design skjer i runder. Vent på ditt øyeblikk.',
      tee: [0, 0, 12],
      cup: [8, 0, -8],
      pieces: [
        floor(0, 4, 4, 20),
        floor(4, -8, 12, 4),
        outline([[-2, 14], [2, 14], [2, -6], [10, -6], [10, -10], [-2, -10]]),
        windmill(0, 0, 'n', { speed: 1.3, sailColors: ['red', 'yellow', 'blue', 'grey'] }),
        card(6, -11.3, 's', {
          y: 2.2,
          title: 'Iterasjon',
          lines: ['Design skjer i runder.', 'Fire seil i logoens farger –', 'vent på ditt øyeblikk, og slå.'],
        }),
      ],
    },
    {
      // "Dokumentasjon". A 10 × 20 m field. The first half is a slalom past a log and a
      // post; across the middle stands quiz gate 2. The right answer (Toast) lines up
      // with a hollow log that carries the ball straight at the cup; the wrong doors
      // run into bumper posts.
      name: 'Tømmerløypa',
      par: 4,
      intro: 'Les dokumentasjonen, eller ta slalåmen.',
      tee: [-3.5, 0, 8],
      cup: [0, 0, -8.5],
      pieces: [
        floor(0, 0, 10, 20),
        outline(rect(-5, -10, 5, 10)),
        wall(-1.5, 10, -1.5, 3.5),
        bumper(2.6, 6, { r: 0.35 }),
        quiz(0, 0, 'n', {
          width: 10,
          question: 'Hvilken komponent viser en kort melding som forsvinner av seg selv?',
          answers: ['Dialog', 'Toast', 'Table'],
          correct: 1,
        }),
        // Behind the gate the field splits into three corridors. The middle one (door B)
        // holds the hollow log and opens straight into the cup room. The side corridors
        // (doors A and C) are walled off from the cup room except for a narrow slot in
        // the far outer corner, off the door's line and behind a post, so a wrong answer
        // costs a couple of careful strokes.
        wall(-1.5, 0, -1.5, -6.5),
        wall(1.5, 0, 1.5, -6.5),
        wall(-1.5, -6.5, -3.8, -6.5),
        wall(1.5, -6.5, 3.8, -6.5),
        tunnel(0, -3.2, 3.6, 'n', { r: 0.6 }),
        bumper(-3.25, -3.5, { r: 0.35 }),
        bumper(3.25, -3.5, { r: 0.35 }),
        card(0, -11.3, 's', {
          y: 2.2,
          title: 'Dokumentasjon',
          lines: ['Les deg fram, eller ta slalåmen.', 'Komponenter, retningslinjer', 'og mønstre – alt er dokumentert.'],
        }),
      ],
    },
    {
      // "Universell utforming". Two rooms split by water. The direct route is a narrow
      // bridge behind a closed gate; the Skip link button in the first room opens it.
      // The long way is a fiddly strip along the east edge with two stub logs.
      name: 'Vannveien',
      par: 3,
      intro: 'Alle skal fram. Bygg broen.',
      tee: [0, 0, 9],
      cup: [-2, 0, -7],
      pieces: [
        floor(0, 7, 8, 8),
        floor(-2.375, 0, 3.25, 6, { mat: 'water' }),
        floor(0, 0, 1.5, 6),
        floor(1.625, 0, 1.75, 6, { mat: 'water' }),
        floor(3.25, 0, 1.5, 6),
        floor(0, -6, 8, 6),
        outline(rect(-4, -9, 4, 11)),
        post(-0.75, 3),
        post(0.75, 3),
        gate(-0.75, 3, 0.75, 3, { id: 'skip' }),
        button(0, 6.2, {
          w: 2.4, d: 1.1, label: 'Hopp til hovedinnhold', opens: 'skip',
          doneLabel: 'Hoppet over', message: 'Skip link! Broen er åpen.',
        }),
        wall(2.5, 1.4, 3.3, 1.4),
        wall(3.2, -1.4, 4, -1.4),
        card(0, -10.3, 's', {
          y: 2.2,
          title: 'Universell utforming',
          lines: ['Alle skal fram.', 'Skip link lar tastaturbrukere hoppe', 'rett til hovedinnholdet.'],
          button: 'Hopp til hovedinnhold',
        }),
      ],
    },
    {
      // "Kvalitetssikring". A 24 m lane guarded by two giant Switch components whose
      // thumbs slide across in counter-phase.
      name: 'Portvaktene',
      par: 3,
      intro: 'To portvakter, én rytme.',
      tee: [0, 0, 10],
      cup: [0, 0, -10],
      pieces: [
        floor(0, 0, 5, 24),
        outline(rect(-2.5, -12, 2.5, 12)),
        slider(0, 3, 1.6, 0.4, 'x', 1.6, 1.6, { look: 'switch', r: 0.5 }),
        slider(0, -4, 1.6, 0.4, 'x', 1.6, 1.6, { look: 'switch', r: 0.5, phase: Math.PI }),
        card(0, -13.3, 's', {
          y: 2.2,
          title: 'Kvalitetssikring',
          lines: ['To Switch-brytere, én rytme.', 'Bare godt arbeid slipper', 'gjennom begge portvaktene.'],
        }),
      ],
    },
    {
      // "Adopsjon". Three 20 m lanes stacked in an S, labelled like the site's
      // breadcrumb (Kom i gang › Komponenter › Mønstre). Quiz gate 3 guards the
      // middle lane: asChild leads straight into the hollow log, the others into posts.
      name: 'Slalåmen',
      par: 4,
      intro: 'Mange team, ett system.',
      tee: [-7, 0, 6],
      cup: [7, 0, -7],
      pieces: [
        floor(0, 6, 20, 4),
        floor(8, 3.5, 4, 1),
        floor(0, 0, 20, 6),
        floor(-8, -4, 4, 2),
        floor(0, -7, 20, 4),
        outline([
          [-10, 8], [10, 8], [10, -3], [-6, -3], [-6, -5], [10, -5],
          [10, -9], [-10, -9], [-10, 3], [6, 3], [6, 4], [-10, 4],
        ]),
        quiz(6, 0, 'w', {
          width: 6, spacing: 1.9, opening: 1.0,
          question: 'Hvilken prop gir komposisjon i React uten ekstra DOM-elementer?',
          answers: ['render', 'asChild', 'slot'],
          correct: 1,
        }),
        tunnel(1.5, 0, 6, 'e', { r: 0.6 }),
        bumper(3.2, 2.0, { r: 0.35 }),
        bumper(3.2, -2.0, { r: 0.35 }),
        bumper(0, -7, { r: 0.4 }),
        plaque(-4, 7.4, 'Kom i gang'),
        plaque(-2, 2.5, 'Komponenter'),
        plaque(7, -8.4, 'Mønstre'),
        card(7, -10.3, 's', {
          y: 2.2,
          title: 'Adopsjon',
          lines: ['Mange team, ett system.', 'Kom i gang › Komponenter › Mønstre', 'Det som deles, går raskere.'],
        }),
      ],
    },
    {
      // "Lansering". Up the ramp, click Publiser, past the spinner, through the gate it
      // opened, down again into the launch room where four logo-coloured posts guard
      // the cup under a big logo flag.
      name: 'Toppen',
      par: 4,
      intro: 'Lansering! Alt du har lært, på ett hull.',
      tee: [0, 0, 13],
      cup: [0, 0, -14.5],
      flag: { scale: 1.6, logoOnly: true },
      pieces: [
        floor(0, 11, 4, 8),
        ramp(0, 5, 4, 4, 1.2, 'n'),
        floor(0, -1, 6, 8, { y: 1.2 }),
        button(0, 1.7, {
          y: 1.2, label: 'Publiser', opens: 'lansering',
          doneLabel: 'Publisert', message: 'Publisert! Porten til lanseringen er åpen.',
        }),
        spinner(0, -1.2, 3.4, 1.5, { y: 1.2 }),
        gate(-2, -5, 2, -5, { y: 1.2, id: 'lansering' }),
        ramp(0, -7, 4, 4, 1.2, 's'),
        floor(0, -13, 8, 8),
        outline([
          [-2, 15, 0], [2, 15, 0], [2, 7, 0], [2, 3, 1.2], [3, 3, 1.2], [3, -5, 1.2], [2, -5, 1.2], [2, -9, 0],
          [4, -9, 0], [4, -17, 0], [-4, -17, 0], [-4, -9, 0], [-2, -9, 0], [-2, -5, 1.2], [-3, -5, 1.2],
          [-3, 3, 1.2], [-2, 3, 1.2], [-2, 7, 0],
        ]),
        bumper(0, -12.6, { r: 0.3, color: 'grey' }),
        bumper(-1.7, -14.5, { r: 0.3, color: 'yellow' }),
        bumper(1.7, -14.5, { r: 0.3, color: 'blue' }),
        bumper(0, -16.2, { r: 0.3, color: 'red' }),
        plaque(-2.5, -16.4, 'Lansert!', { bg: 'blue', fg: '#ffffff' }),
        card(0, -18.4, 's', {
          y: 2.3,
          title: 'Lansering',
          lines: ['Gratulerer – tjenesten er lansert!', 'Laget med Designsystemet:', 'komponenter, retningslinjer og mønstre.'],
          button: 'Publiser',
        }),
      ],
    },
  ],
};

export const helpers = { floor, outline, wall, ramp, bumper, spinner, slider, box, tunnel, windmill, quiz, chute, hill, plaque, button, gate, card, post, rect };
