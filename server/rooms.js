// Room + game-flow management. The server is the authority on room membership,
// hole progression and scores. Ball physics runs on each client (like Golf With
// Your Friends), and the server simply relays ball positions to the other players.

export const MAX_STROKES = 12;
const SCOREBOARD_MS = 8000;
// Turn-based: one stroke each, in join order. A player has TURN_TIME_MS to take the
// stroke, then the turn is skipped; ROLL_TIME_MS is a safety net if a client never
// reports its ball at rest. The hole clock grows with the number of players.
const TURN_TIME_MS = Number(process.env.TURN_TIME_MS) || 30000;
const ROLL_TIME_MS = Number(process.env.ROLL_TIME_MS) || 25000;
const holeTimeFor = (players) => Math.min(10 * 60 * 1000, 2 * 60 * 1000 + players * 45 * 1000);
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
        scores: p.scores,
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
    socket.on('room:start', (payload) => this.start(socket, payload ?? {}));
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
    socket.on('disconnect', () => this.leave(socket));
  }

  roomOf(socket) {
    return socket.data.code ? this.rooms.get(socket.data.code) : null;
  }

  broadcast(room) {
    this.io.to(room.code).emit('room:state', room.snapshot());
  }

  addPlayer(room, socket, name) {
    const player = {
      id: socket.id,
      name: cleanName(name),
      color: room.pickColor(),
      strokes: 0,
      done: false,
      scores: [],
    };
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

  create(socket, { name }, cb) {
    if (this.roomOf(socket)) this.leave(socket);
    const room = new Room(makeCode(this.rooms));
    this.rooms.set(room.code, room);
    this.addPlayer(room, socket, name);
    cb({ ok: true, code: room.code, id: socket.id });
    this.broadcast(room);
  }

  join(socket, { code, name }, cb) {
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) return cb({ ok: false, error: 'Fant ikke rommet. Sjekk koden og prøv igjen.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Rommet er fullt.' });
    if (this.roomOf(socket)) this.leave(socket);
    this.addPlayer(room, socket, name);
    cb({ ok: true, code: room.code, id: socket.id });
    this.broadcast(room);
  }

  start(socket, { holeCount, startHole }) {
    const room = this.roomOf(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'lobby' && room.state !== 'finished') return;
    room.startIndex = clampInt(startHole, 0, 17, 0);
    room.holeCount = clampInt(holeCount, 1, 18 - room.startIndex, 9);
    for (const p of room.players.values()) p.scores = [];
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
    }
    room.timer = setTimeout(() => this.endHole(room), room.holeTimeMs);
    this.setTurn(room, this.playerAfter(room, null));
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
      if (!p.done) return p;
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
      // Took too long to shoot: pass the turn on without a stroke.
      if (room.state === 'playing' && room.turnId === player.id && room.turnPhase === 'aim') this.nextTurn(room);
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

  holeDone(socket, { strokes }) {
    const room = this.roomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.state !== 'playing' || player.done) return;
    player.done = true;
    player.strokes = clampInt(strokes, 1, MAX_STROKES, MAX_STROKES);
    player.scores[room.holeIndex] = player.strokes;
    this.io.to(room.code).emit('player:done', {
      id: socket.id,
      strokes: player.strokes,
      sunk: player.strokes < MAX_STROKES,
    });
    if (room.turnId === socket.id) this.setTurn(room, this.playerAfter(room, socket.id));
    this.broadcast(room);
    this.checkAllDone(room);
  }

  checkAllDone(room) {
    if (room.state !== 'playing') return;
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
      p.strokes = 0;
      p.done = false;
    }
    this.broadcast(room);
  }

  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(room.code);
    socket.data.code = null;
    if (room.players.size === 0) {
      this.clearTimer(room);
      this.clearTurnTimer(room);
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    // The leaver had the turn: hand it to the next player still going.
    if (room.state === 'playing' && room.turnId === socket.id) this.setTurn(room, this.playerAfter(room, null));
    this.broadcast(room);
    this.checkAllDone(room);
  }

  clearTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }
}
