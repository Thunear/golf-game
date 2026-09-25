import './style.css';
import { Net } from './net.js';
import { UI } from './ui.js';
import { Game, MAX_STROKES } from './game.js';
import { COURSE } from './course/holes.js';

const ui = new UI();
const net = new Net();
let game = null;
let roomState = null;
let timerHandle = null;
let shotPending = false; // we have shot and not yet told the server the ball stopped
let quizBonus = 0; // strokes taken off this hole for a correct quiz answer

ui.setHoleOptions(COURSE);
ui.show('lobby');

// ---------- lobby actions ----------
ui.on('create', async ({ name }) => {
  ui.setError(null);
  ui.setBusy(true);
  const res = await net.createRoom(name);
  ui.setBusy(false);
  if (!res.ok) return ui.setError(res.error);
  history.replaceState(null, '', `?room=${res.code}`);
});

ui.on('join', async ({ name, code }) => {
  ui.setError(null);
  if (code.length !== 4) return ui.setError('Romkoder har 4 bokstaver.');
  ui.setBusy(true);
  const res = await net.joinRoom(code, name);
  ui.setBusy(false);
  if (!res.ok) return ui.setError(res.error);
  history.replaceState(null, '', `?room=${res.code}`);
});

ui.on('start', ({ holeCount, startHole }) => net.startGame(holeCount, startHole));
ui.on('lobby', () => net.backToLobby());
ui.on('leave', () => {
  net.leaveRoom();
  roomState = null;
  stopTimer();
  if (game) {
    game.destroy();
    game = null;
  }
  history.replaceState(null, '', location.pathname);
  ui.show('lobby');
});

net.on('disconnect', () => {
  if (roomState) ui.toast('Mistet forbindelsen. Prøver å koble til igjen…');
});

// ---------- game events ----------
function ensureGame() {
  if (game) return game;
  game = new Game({
    container: document.getElementById('game-container'),
    course: COURSE,
    onEvent: onGameEvent,
  });
  game.setServerClock(() => net.serverNow());
  return game;
}

function me() {
  return roomState?.players.find((p) => p.id === net.id);
}

function onGameEvent(type, data) {
  switch (type) {
    case 'aim':
      ui.setPower(data.power);
      break;
    case 'shot':
      ui.setStrokes(data.strokes, quizBonus);
      ui.setStatus('Ruller…');
      shotPending = true;
      net.sendShot();
      net.sendStrokes(data.strokes);
      break;
    case 'strokes':
      ui.setStrokes(data.strokes, quizBonus);
      break;
    case 'penalty':
      ui.setStrokes(data.strokes, quizBonus);
      ui.toast(data.message);
      net.sendStrokes(data.strokes);
      break;
    case 'quiz':
      quizBonus = data.bonus;
      ui.setStrokes(game.ball.strokes, quizBonus);
      break;
    case 'ready':
      // Ball came to rest after our stroke: the turn passes on.
      if (data.ready && shotPending) {
        shotPending = false;
        net.sendRest();
      }
      if (data.ready && !game.ball.finished && roomState?.turnId === net.id) updateTurnStatus();
      break;
    case 'done': {
      shotPending = false;
      net.sendDone(data.strokes, data.bonus);
      ui.setStrokes(data.strokes, data.bonus);
      const bonusNote = data.bonus ? ` ★ Riktig svar: ${data.rawStrokes} − 1 = ${data.strokes}.` : '';
      if (data.sunk) {
        const par = COURSE.holes[roomState?.holeIndex ?? 0]?.par ?? 0;
        ui.setStatus(`${scoreName(data.strokes, par)}${bonusNote} Venter på de andre…`);
      } else {
        ui.setStatus(`Slaggrensen er nådd.${bonusNote} Venter på de andre…`);
      }
      break;
    }
    case 'ball':
      net.sendBall(data.p, data.q);
      break;
    case 'mute':
      ui.toast(data.muted ? 'Lyd av' : 'Lyd på');
      break;
    case 'toast':
      ui.toast(data.message);
      break;
    case 'spectate':
      ui.setSpectate(data);
      break;
  }
}

// Status line under the power bar, depending on whose turn it is.
function updateTurnStatus() {
  const st = roomState;
  if (!st || st.state !== 'playing' || !game || game.ball.finished) return;
  const mine = me();
  if (mine?.done) return;
  if (st.turnId === net.id) {
    if (st.turnPhase === 'rolling') return ui.setStatus('Ruller…');
    const secs = Math.max(0, Math.ceil((st.turnStartedAt + st.turnTimeMs - net.serverNow()) / 1000));
    const left = MAX_STROKES - game.ball.strokes;
    const strokesNote = left <= 3 ? ` · ${left} slag igjen` : '';
    ui.setStatus(`Din tur! Dra fra ballen for å sikte, slipp for å slå · ${secs} s${strokesNote}`);
  } else {
    const who = st.players.find((p) => p.id === st.turnId);
    ui.setStatus(who ? `Venter på ${who.name}…` : 'Venter…');
  }
}

function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par.';
  if (d === 1) return 'Bogey.';
  if (d === 2) return 'Dobbeltbogey.';
  return `Inne på ${strokes}.`;
}

// ---------- room state ----------
net.on('room:state', (state) => {
  const prev = roomState;
  roomState = state;
  const myId = net.id;

  switch (state.state) {
    case 'lobby':
      stopTimer();
      if (game) {
        game.destroy();
        game = null;
      }
      ui.renderRoom(state, myId);
      ui.show('room');
      if (prev?.state !== 'lobby') ui.showControlsIfNew();
      break;

    case 'playing': {
      const g = ensureGame();
      const mine = me();
      if (mine) g.setLocalPlayer({ color: mine.color, id: myId });
      if (g.holeIndex !== state.holeIndex || prev?.state !== 'playing') {
        g.startHole(state.holeIndex, state.holeStartAt);
        shotPending = false;
        quizBonus = 0;
        ui.setPower(null);
        const hole = COURSE.holes[state.holeIndex];
        ui.toast(`Hull ${state.holeIndex + 1}: ${hole.name} · Par ${hole.par}`, hole.intro);
      }
      // One stroke at a time: only the player whose turn it is may shoot.
      const myTurn = state.turnId === myId && state.turnPhase === 'aim';
      if (myTurn && !(prev?.turnId === myId && prev?.turnPhase === 'aim') && !mine?.done) ui.toast('Din tur!');
      g.setPlaying(myTurn);
      g.syncPlayers(state.players, myId);
      g.setTurn(state.turnId);
      ui.renderHud(state, COURSE, myId);
      updateTurnStatus();
      ui.show('game');
      startTimer();
      break;
    }

    case 'scoreboard':
    case 'finished': {
      stopTimer();
      if (game) {
        game.setPlaying(false);
        game.syncPlayers(state.players, myId);
      }
      ui.renderHud(state, COURSE, myId);
      ui.renderScoreboard(state, COURSE, myId, { final: state.state === 'finished' });
      ui.show('score');
      break;
    }
  }
});

net.on('ball:state', (data) => game?.onRemoteBall(data));

net.on('player:done', ({ id, strokes, sunk }) => {
  if (id === net.id || !roomState) return;
  const p = roomState.players.find((x) => x.id === id);
  if (!p) return;
  const par = COURSE.holes[roomState.holeIndex]?.par ?? 0;
  ui.toast(sunk ? `${p.name} senket den på ${strokes} · ${scoreName(strokes, par)}` : `${p.name} nådde slaggrensen`);
});

// ---------- hole timer ----------
function startTimer() {
  if (timerHandle) return;
  const tick = () => {
    if (!roomState || roomState.state !== 'playing') return;
    const end = roomState.holeStartAt + roomState.holeTimeMs;
    ui.setTimer((end - net.serverNow()) / 1000);
    if (roomState.turnId === net.id && roomState.turnPhase === 'aim') updateTurnStatus();
  };
  tick();
  timerHandle = setInterval(tick, 250);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

// Debug handle for the browser console / automated tests.
window.__ff = {
  get game() { return game; },
  get room() { return roomState; },
  net,
};
