// Room + game-flow management. The server is the authority on room membership,
// hole progression and scores. Ball physics runs on each client (like Golf With
// Your Friends), and the server simply relays ball positions to the other players.

export const MAX_STROKES = 12;
const SCOREBOARD_MS = 8000;
// Turn-based: one stroke each, in join order. A player has TURN_TIME_MS to take the
// stroke, then the turn is skipped; ROLL_TIME_MS is a safety net if a client never
// reports its ball at rest. The hole clock grows with the number of players.
const TURN_TIME_MS = Number(process.env.TURN_TIME_MS) || 45000;
const ROLL_TIME_MS = Number(process.env.ROLL_TIME_MS) || 20000;
// Letting the shot clock run out this many times in a row finishes the hole for that
// player at the stroke limit, so one absent player cannot stall the group. The hole
// clock itself is only a generous backstop.
const MAX_SKIPS = Number(process.env.MAX_SKIPS) || 3;
const holeTimeFor = (players) => Math.min(20 * 60 * 1000, 4 * 60 * 1000 + players * 2 * 60 * 1000);
// A player whose socket drops keeps their seat (scores, colour, turn order) this long,
// so a network blip or a reload does not throw them out of the game.
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 90000;

function cleanToken(t) {
  const s = String(t ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return s || null;
}
const MAX_PLAYERS = 12;
const COLORS = [
  '#ff5252', '#3d8bff', '#3ddc84', '#ffd23f', '#ff7ee8', '#ff9a3d',
  '#5ee7ff', '#b388ff', '#f5f5f5', '#a3ff5e', '#ff6ea8', '#4dd0b0',
];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeCode(existing) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  } while (existing.has(code));
  return code;
}

function cleanName(n) {
  const s = String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s || 'Spiller';
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

class Room {
  constructor(code) {
    this.code = code;
    this.hostId = null;
    this.players = new Map(); // id -> player
    this.state = 'lobby'; // lobby | playing | scoreboard | finished
    this.holeIndex = -1;
    this.startIndex = 0; // first hole of this round (0-based)
    this.holeCount = 9; // how many holes to play from startIndex
    this.holeStartAt = 0;
    this.holeTimeMs = holeTimeFor(1);
    this.timer = null;
    // Whose stroke it is, and whether they are still aiming or their ball is rolling.
    this.turnId = null;
    this.turnPhase = 'aim'; // aim | rolling
    this.turnStartedAt = 0;
    this.turnTimer = null;
  }

  pickColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[this.players.size % COLORS.length];
  }

  snapshot() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      holeIndex: this.holeIndex,
      startIndex: this.startIndex,
      holeCount: this.holeCount,
      holeStartAt: this.holeStartAt,
      holeTimeMs: this.holeTimeMs,
      maxStrokes: MAX_STROKES,
      turnId: this.turnId,
      turnPhase: this.turnPhase,
      turnStartedAt: this.turnStartedAt,
      turnTimeMs: TURN_TIME_MS,
      serverTime: Date.now(),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        strokes: p.strokes,
        done: p.done,
        connected: p.connected,
        scores: p.scores,
        bonuses: p.bonuses,
      })),
    };
  }
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  attach(socket) {
    socket.data.code = null;
    const cbOk = (cb) => (typeof cb === 'function' ? cb : () => {});

    socket.on('room:create', (payload, cb) => this.create(socket, payload ?? {}, cbOk(cb)));
    socket.on('room:join', (payload, cb) => this.join(socket, payload ?? {}, cbOk(cb)));
    socket.on('room:start', (payload, cb) => this.start(socket, payload ?? {}, cbOk(cb)));
    socket.on('room:lobby', () => this.toLobby(socket));
    socket.on('room:leave', () => this.leave(socket));

    socket.on('ball:state', (state) => {
      const room = this.roomOf(socket);
      if (!room || room.state !== 'playing' || !state) return;
      socket.to(room.code).volatile.emit('ball:state', { id: socket.id, p: state.p, q: state.q });
    });

    socket.on('ball:shot', () => this.onShot(socket));
    socket.on('ball:rest', () => this.onRest(socket));

    socket.on('player:strokes', (payload) => {
      const room = this.roomOf(socket);
      const player = room?.players.get(socket.id);
      if (!room || !player || room.state !== 'playing' || player.done) return;
      player.strokes = clampInt(payload?.strokes, 0, MAX_STROKES, player.strokes);
      this.broadcast(room);
    });

    socket.on('hole:done', (payload) => this.holeDone(socket, payload ?? {}));
    socket.on('disconnect', () => this.disconnect(socket));
  }

  roomOf(socket) {
    return socket.data.code ? this.rooms.get(socket.data.code) : null;
  }

  broadcast(room) {
    this.io.to(room.code).emit('room:state', room.snapshot());
  }

  addPlayer(room, socket, name, token) {
    const player = {
      id: socket.id,
      token,
      connected: true,
      dropTimer: null,
      name: cleanName(name),
      color: room.pickColor(),
      strokes: 0,
      done: false,
      scores: [],
      bonuses: [], // holes where a correct quiz answer took a stroke off
    };
    player.joinedAt = Date.now();
    // Late joiners get blanks for holes already played.
    if (room.state !== 'lobby') {
      for (let i = 0; i < room.holeIndex; i++) player.scores[i] = null;
      if (room.state !== 'playing') {
        player.done = true;
        player.scores[room.holeIndex] = null;
      }
    }
    room.players.set(socket.id, player);
    socket.data.code = room.code;
    socket.join(room.code);
    if (!room.hostId) room.hostId = socket.id;
    return player;
  }

  create(socket, { name, token }, cb) {
    if (this.roomOf(socket)) this.leave(socket);
    const room = new Room(makeCode(this.rooms));
    this.rooms.set(room.code, room);
    this.addPlayer(room, socket, name, cleanToken(token));
    cb({ ok: true, code: room.code, id: socket.id });
    this.broadcast(room);
  }

  join(socket, { code, name, token }, cb) {
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) return cb({ ok: false, error: 'Fant ikke rommet. Sjekk koden og prøv igjen.' });
    if (this.roomOf(socket)) this.leave(socket);
    // Same browser tab coming back (reconnect or reload): take the old seat over.
    const tok = cleanToken(token);
    const seat = tok ? [...room.players.values()].find((p) => p.token === tok) : null;
    if (seat) {
      this.reseat(room, seat, socket);
      cb({ ok: true, code: room.code, id: socket.id, rejoined: true, strokes: seat.strokes, done: seat.done });
      this.broadcast(room);
      return;
    }
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Rommet er fullt.' });
    this.addPlayer(room, socket, name, tok);
    cb({ ok: true, code: room.code, id: socket.id });
    this.broadcast(room);
  }

  // Moves an existing player entry onto a new socket.
  reseat(room, player, socket) {
    if (player.dropTimer) clearTimeout(player.dropTimer);
    player.dropTimer = null;
    const oldId = player.id;
    room.players.delete(oldId);
    player.id = socket.id;
    player.connected = true;
    // Keep the original join order so turns stay predictable.
    const entries = [...room.players.entries()];
    room.players.clear();
    let placed = false;
    for (const [id, p] of entries) {
      if (!placed && p.joinedAt > player.joinedAt) { room.players.set(player.id, player); placed = true; }
      room.players.set(id, p);
    }
    if (!placed) room.players.set(player.id, player);
    if (room.hostId === oldId) room.hostId = player.id;
    if (room.turnId === oldId) room.turnId = player.id;
    socket.data.code = room.code;
    socket.join(room.code);
    // Everyone else may be done and waiting for us: give us the turn straight away.
    if (room.state === 'playing' && room.turnId === null && !player.done) this.setTurn(room, player);
  }

  // Socket dropped: keep the seat for a while, but never let it hold up the game.
  disconnect(socket) {
    const room = this.roomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    player.connected = false;
    socket.data.code = null;
    if (room.state === 'playing' && room.turnId === player.id) this.setTurn(room, this.playerAfter(room, player.id));
    player.dropTimer = setTimeout(() => {
      player.dropTimer = null;
      if (room.players.get(player.id) === player && !player.connected) this.removePlayer(room, player.id);
    }, RECONNECT_GRACE_MS);
    this.broadcast(room);
    this.checkAllDone(room);
  }

  // Only the host may start (or restart) a game.
  start(socket, { holeCount, startHole }, cb = () => {}) {
    const room = this.roomOf(socket);
    if (!room) return cb({ ok: false, error: 'Du er ikke i et rom.' });
    if (room.hostId !== socket.id) return cb({ ok: false, error: 'Bare verten kan starte spillet.' });
    if (room.state !== 'lobby' && room.state !== 'finished') return cb({ ok: false, error: 'Spillet er allerede i gang.' });
    cb({ ok: true });
    room.startIndex = clampInt(startHole, 0, 17, 0);
    room.holeCount = clampInt(holeCount, 1, 18 - room.startIndex, 9);
    for (const p of room.players.values()) { p.scores = []; p.bonuses = []; }
    this.startHole(room, room.startIndex);
  }

  startHole(room, index) {
    this.clearTimer(room);
    room.state = 'playing';
    room.holeIndex = index;
    room.holeStartAt = Date.now();
    room.holeTimeMs = holeTimeFor(room.players.size);
    for (const p of room.players.values()) {
      p.strokes = 0;
      p.done = false;
      p.skips = 0;
    }
    room.timer = setTimeout(() => this.endHole(room), room.holeTimeMs);
    // A random player opens the hole; the rotation continues in join order from there.
    const openers = [...room.players.values()].filter((p) => p.connected && !p.done);
    const opener = openers.length ? openers[Math.floor(Math.random() * openers.length)] : null;
    this.setTurn(room, opener ?? this.playerAfter(room, null));
    this.broadcast(room);
  }

  // ----- turns -----
  // Next player who still has to finish, in join order after `fromId`
  // (or from the start when fromId is null). Falls back to the same player
  // when nobody else is left.
  playerAfter(room, fromId) {
    const order = [...room.players.values()];
    const n = order.length;
    if (!n) return null;
    const idx = order.findIndex((p) => p.id === fromId);
    const first = idx < 0 ? 0 : 1;
    for (let k = first; k < first + n; k++) {
      const p = order[(Math.max(idx, 0) + k) % n];
      if (!p.done && p.connected) return p;
    }
    return null;
  }

  setTurn(room, player) {
    this.clearTurnTimer(room);
    room.turnId = player?.id ?? null;
    room.turnPhase = 'aim';
    room.turnStartedAt = Date.now();
    if (!player) return;
    room.turnTimer = setTimeout(() => {
      // Took too long to shoot: pass the turn on without a stroke. Three in a row
      // and the player is finished at the stroke limit.
      if (room.state !== 'playing' || room.turnId !== player.id || room.turnPhase !== 'aim') return;
      player.skips = (player.skips ?? 0) + 1;
      this.io.to(room.code).emit('turn:skipped', { id: player.id, skips: player.skips, max: MAX_SKIPS });
      if (player.skips >= MAX_SKIPS) this.finishPlayer(room, player, MAX_STROKES, false);
      else this.nextTurn(room);
    }, TURN_TIME_MS);
  }

  nextTurn(room) {
    if (room.state !== 'playing') return;
    this.setTurn(room, this.playerAfter(room, room.turnId));
    this.broadcast(room);
  }

  onShot(socket) {
    const room = this.roomOf(socket);
    if (!room || room.state !== 'playing') return;
    socket.to(room.code).emit('ball:shot', { id: socket.id });
    if (room.turnId !== socket.id || room.turnPhase !== 'aim') return;
    this.clearTurnTimer(room);
    room.players.get(socket.id).skips = 0;
    room.turnPhase = 'rolling';
    room.turnStartedAt = Date.now();
    room.turnTimer = setTimeout(() => {
      if (room.state === 'playing' && room.turnId === socket.id && room.turnPhase === 'rolling') this.nextTurn(room);
    }, ROLL_TIME_MS);
    this.broadcast(room);
  }

  onRest(socket) {
    const room = this.roomOf(socket);
    if (!room || room.state !== 'playing') return;
    if (room.turnId === socket.id && room.turnPhase === 'rolling') this.nextTurn(room);
  }

  clearTurnTimer(room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }

  holeDone(socket, { strokes, bonus }) {
    const room = this.roomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.state !== 'playing' || player.done) return;
    this.finishPlayer(room, player, clampInt(strokes, 1, MAX_STROKES, MAX_STROKES), clampInt(bonus, 0, 1, 0) === 1);
  }

  // Records a player's result for the current hole and moves the turn on if needed.
  finishPlayer(room, player, strokes, bonus) {
    if (room.state !== 'playing' || player.done) return;
    player.done = true;
    player.strokes = strokes;
    player.scores[room.holeIndex] = strokes;
    player.bonuses[room.holeIndex] = !!bonus;
    this.io.to(room.code).emit('player:done', {
      id: player.id,
      strokes,
      sunk: strokes < MAX_STROKES,
    });
    if (room.turnId === player.id) this.setTurn(room, this.playerAfter(room, player.id));
    this.broadcast(room);
    this.checkAllDone(room);
  }

  checkAllDone(room) {
    if (room.state !== 'playing') return;
    // Everyone has to be done, including players who are briefly disconnected: their
    // seat is dropped after the reconnect grace, which re-runs this check. Meanwhile
    // the turn skips them, so nobody is blocked from playing.
    const all = [...room.players.values()].every((p) => p.done);
    if (all && room.players.size > 0) this.endHole(room);
  }

  endHole(room) {
    if (room.state !== 'playing') return;
    this.clearTimer(room);
    this.clearTurnTimer(room);
    room.turnId = null;
    for (const p of room.players.values()) {
      if (!p.done) {
        p.done = true;
        p.strokes = MAX_STROKES;
        p.scores[room.holeIndex] = MAX_STROKES;
      }
    }
    const last = room.holeIndex + 1 >= room.startIndex + room.holeCount;
    room.state = last ? 'finished' : 'scoreboard';
    this.broadcast(room);
    if (!last) room.timer = setTimeout(() => this.startHole(room, room.holeIndex + 1), SCOREBOARD_MS);
  }

  toLobby(socket) {
    const room = this.roomOf(socket);
    if (!room || room.hostId !== socket.id) return;
    this.clearTimer(room);
    this.clearTurnTimer(room);
    room.turnId = null;
    room.state = 'lobby';
    room.holeIndex = -1;
    for (const p of room.players.values()) {
      p.scores = [];
      p.bonuses = [];
      p.strokes = 0;
      p.done = false;
    }
    this.broadcast(room);
  }

  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    socket.leave(room.code);
    socket.data.code = null;
    this.removePlayer(room, socket.id);
  }

  removePlayer(room, id) {
    const player = room.players.get(id);
    if (!player) return;
    if (player.dropTimer) clearTimeout(player.dropTimer);
    room.players.delete(id);
    if (room.players.size === 0) {
      this.clearTimer(room);
      this.clearTurnTimer(room);
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === id) room.hostId = [...room.players.values()].find((p) => p.connected)?.id ?? room.players.keys().next().value;
    // The leaver had the turn: hand it to the next player still going.
    if (room.state === 'playing' && room.turnId === id) this.setTurn(room, this.playerAfter(room, null));
    this.broadcast(room);
    this.checkAllDone(room);
  }

  clearTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }
}
