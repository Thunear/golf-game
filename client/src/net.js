// Thin wrapper around socket.io with a tiny event emitter and server-time sync.
import { io } from 'socket.io-client';

export class Net {
  constructor() {
    // Same origin by default. When the client is hosted separately (e.g. Netlify)
    // VITE_SERVER_URL points at the game server.
    const url = import.meta.env.VITE_SERVER_URL || undefined;
    this.socket = io(url, { autoConnect: true, transports: ['websocket', 'polling'] });
    this.id = null;
    this.timeOffset = 0; // serverTime - Date.now()
    this.handlers = new Map();

    this.socket.on('connect', () => {
      this.id = this.socket.id;
      this.emitLocal('connect');
    });
    this.socket.on('disconnect', () => this.emitLocal('disconnect'));
    this.socket.on('room:state', (state) => {
      // Smooth the clock offset a bit so jittery packets don't make movers stutter.
      const sample = state.serverTime - Date.now();
      this.timeOffset = this.timeOffset === 0 ? sample : this.timeOffset * 0.7 + sample * 0.3;
      this.emitLocal('room:state', state);
    });
    for (const ev of ['ball:state', 'ball:shot', 'player:done']) {
      this.socket.on(ev, (data) => this.emitLocal(ev, data));
    }
  }

  serverNow() {
    return Date.now() + this.timeOffset;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event).delete(fn);
  }

  emitLocal(event, data) {
    const set = this.handlers.get(event);
    if (set) for (const fn of set) fn(data);
  }

  request(event, payload) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'Ingen svar fra serveren.' }), 6000);
      this.socket.emit(event, payload, (res) => {
        clearTimeout(timer);
        resolve(res ?? { ok: false, error: 'Tomt svar fra serveren.' });
      });
    });
  }

  createRoom(name) { return this.request('room:create', { name }); }
  joinRoom(code, name) { return this.request('room:join', { code, name }); }
  startGame(holeCount, startHole = 0) { this.socket.emit('room:start', { holeCount, startHole }); }
  backToLobby() { this.socket.emit('room:lobby'); }
  leaveRoom() { this.socket.emit('room:leave'); }

  sendBall(p, q) { this.socket.volatile.emit('ball:state', { p, q }); }
  sendShot() { this.socket.emit('ball:shot'); }
  sendRest() { this.socket.emit('ball:rest'); }
  sendStrokes(strokes) { this.socket.emit('player:strokes', { strokes }); }
  sendDone(strokes, bonus = 0) { this.socket.emit('hole:done', { strokes, bonus }); }
}
