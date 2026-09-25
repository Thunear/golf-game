// DOM screens: lobby, room, HUD, scoreboard and toasts.
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.handlers = new Map();
    this.el = {
      lobby: $('screen-lobby'),
      room: $('screen-room'),
      score: $('screen-score'),
      hud: $('hud'),
      name: $('name-input'),
      code: $('code-input'),
      create: $('btn-create'),
      join: $('btn-join'),
      error: $('lobby-error'),
      roomCode: $('room-code'),
      copy: $('btn-copy'),
      roomPlayers: $('room-players'),
      hostControls: $('host-controls'),
      holeCount: $('hole-count'),
      startHole: $('start-hole'),
      start: $('btn-start'),
      waiting: $('waiting-msg'),
      leave: $('btn-leave'),
      hudHole: $('hud-hole'),
      hudHoleName: $('hud-hole-name'),
      hudPar: $('hud-par'),
      hudStrokes: $('hud-strokes'),
      hudTimer: $('hud-timer'),
      hudPlayers: $('hud-players'),
      power: $('power'),
      powerFill: $('power-fill'),
      status: $('hud-status'),
      spectate: $('hud-spectate'),
      spectateDot: $('hud-spectate-dot'),
      spectateName: $('hud-spectate-name'),
      spectateHint: $('hud-spectate-hint'),
      scoreTitle: $('score-title'),
      scoreTable: $('score-table'),
      scoreFooter: $('score-footer'),
      again: $('btn-again'),
      toLobby: $('btn-lobby'),
      toasts: $('toasts'),
      controls: $('screen-controls'),
      controlsOk: $('btn-controls-ok'),
      help: $('btn-help'),
    };
    this.el.controlsOk.addEventListener('click', () => this.hideControls());
    this.el.help.addEventListener('click', () => this.showControls());
    this.el.controls.addEventListener('click', (e) => { if (e.target === this.el.controls) this.hideControls(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.controls.hidden) this.hideControls(); });

    const savedName = localStorage.getItem('dsg-name') ?? localStorage.getItem('ff-name');
    if (savedName) this.el.name.value = savedName;
    const params = new URLSearchParams(location.search);
    if (params.get('room')) this.el.code.value = params.get('room').toUpperCase();

    this.el.create.addEventListener('click', () => this.emit('create', { name: this.name() }));
    this.el.join.addEventListener('click', () => this.emit('join', { name: this.name(), code: this.el.code.value.trim().toUpperCase() }));
    this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.el.join.click(); });
    this.el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.el.code.value.trim() ? this.el.join : this.el.create).click();
    });
    const startPayload = () => ({ holeCount: Number(this.el.holeCount.value), startHole: Number(this.el.startHole.value) });
    this.el.start.addEventListener('click', () => this.emit('start', startPayload()));
    this.el.leave.addEventListener('click', () => this.emit('leave'));
    this.el.again.addEventListener('click', () => this.emit('start', startPayload()));
    this.el.startHole.addEventListener('change', () => this.refreshCountOptions());
    this.el.toLobby.addEventListener('click', () => this.emit('lobby'));
    this.el.copy.addEventListener('click', async () => {
      const link = `${location.origin}${location.pathname}?room=${this.el.roomCode.textContent}`;
      try {
        await navigator.clipboard.writeText(link);
        this.toast('Invitasjonslenke kopiert');
      } catch {
        prompt('Kopier denne lenken', link);
      }
    });
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers.get(event) ?? []) fn(data);
  }

  name() {
    const n = this.el.name.value.trim().slice(0, 16) || 'Spiller';
    localStorage.setItem('dsg-name', n);
    return n;
  }

  setBusy(busy) {
    this.el.create.disabled = busy;
    this.el.join.disabled = busy;
  }

  setError(msg) {
    this.el.error.textContent = msg ?? '';
    this.el.error.hidden = !msg;
  }

  setHoleOptions(course) {
    this.course = course;
    const start = this.el.startHole;
    start.innerHTML = '';
    course.holes.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Hull ${i + 1} · ${h.name}`;
      start.appendChild(o);
    });
    start.value = '0';
    this.refreshCountOptions();
  }

  // Count options depend on the chosen start hole: you can only play to the end of the course.
  refreshCountOptions() {
    const total = this.course.holes.length;
    const startIdx = Number(this.el.startHole.value) || 0;
    const max = total - startIdx;
    const sel = this.el.holeCount;
    const prev = Number(sel.value);
    sel.innerHTML = '';
    for (let i = 1; i <= max; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = i === max ? (startIdx === 0 ? `Alle ${i} hull` : `Resten (${i} hull)`) : `${i} hull`;
      sel.appendChild(o);
    }
    sel.value = String(prev >= 1 && prev <= max ? prev : max);
  }

  // "Slik spiller du" popup. Shown automatically the first time this browser
  // enters a room; the ? button in the HUD brings it back.
  showControls() {
    this.el.controls.hidden = false;
    try { localStorage.setItem('dsg-controls-seen', '1'); } catch { /* private mode */ }
  }

  hideControls() {
    this.el.controls.hidden = true;
  }

  showControlsIfNew() {
    let seen = false;
    try { seen = localStorage.getItem('dsg-controls-seen') === '1'; } catch { /* ignore */ }
    if (!seen) this.showControls();
  }

  show(screen) {
    this.el.lobby.hidden = screen !== 'lobby';
    this.el.room.hidden = screen !== 'room';
    this.el.hud.hidden = screen !== 'game' && screen !== 'score';
    this.el.score.hidden = screen !== 'score';
  }

  // ---------- room ----------
  renderRoom(state, myId) {
    this.el.roomCode.textContent = state.code;
    const isHost = state.hostId === myId;
    this.el.hostControls.hidden = !isHost;
    this.el.waiting.hidden = isHost;
    this.el.roomPlayers.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = p.name + (p.id === myId ? ' (deg)' : '');
      li.append(dot, name);
      if (p.id === state.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'vert';
        li.appendChild(tag);
      }
      this.el.roomPlayers.appendChild(li);
    }
  }

  // ---------- HUD ----------
  renderHud(state, course, myId) {
    const hole = course.holes[state.holeIndex];
    if (hole) {
      const start = state.startIndex ?? 0;
      const played = state.holeIndex - start + 1;
      this.el.hudHole.textContent = state.holeCount === course.holes.length
        ? `Hull ${state.holeIndex + 1} av ${state.holeCount}`
        : `Hull ${state.holeIndex + 1} · ${played} av ${state.holeCount}`;
      this.el.hudHoleName.textContent = hole.name;
      this.el.hudPar.textContent = `Par ${hole.par}`;
    }
    this.el.hudPlayers.innerHTML = '';
    const sorted = [...state.players].sort((a, b) => total(a) - total(b));
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'p' + (p.done ? ' done' : '') + (p.id === myId ? ' me' : '') + (p.id === this.spectating ? ' watching' : '') +
        (p.id === state.turnId ? ' turn' : '');
      row.dataset.id = p.id;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = p.done ? `${p.strokes} ✓` : `${p.strokes}`;
      score.title = `Totalt: ${total(p)}`;
      row.append(dot, name, score);
      this.el.hudPlayers.appendChild(row);
    }
  }

  setStrokes(n) {
    this.el.hudStrokes.textContent = n === 0 ? 'Ingen slag ennå' : `Slag ${n}`;
  }

  setPower(p) {
    this.el.power.hidden = p === null || p === undefined;
    if (p != null) this.el.powerFill.style.width = `${Math.round(p * 100)}%`;
  }

  setStatus(text) {
    this.el.status.textContent = text;
  }

  // Banner saying whose ball the camera follows; null hides it.
  setSpectate(spec) {
    this.spectating = spec?.id ?? null;
    this.el.spectate.hidden = !spec;
    if (!spec) return;
    this.el.spectateDot.style.background = spec.color;
    this.el.spectateName.textContent = spec.name;
    this.el.spectateHint.textContent = spec.turn ? `${spec.name} sin tur` : spec.count > 1 ? 'Tab: neste spiller' : '';
    for (const row of this.el.hudPlayers.children) row.classList.toggle('watching', row.dataset.id === spec.id);
  }

  setTimer(secondsLeft) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    const m = Math.floor(s / 60);
    this.el.hudTimer.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
    this.el.hudTimer.classList.toggle('low', s <= 20);
  }

  // ---------- scoreboard ----------
  renderScoreboard(state, course, myId, { final }) {
    // Columns are the holes played so far in this round, labelled by real hole number.
    const start = state.startIndex ?? 0;
    const indices = [];
    for (let i = start; i <= state.holeIndex && i < start + state.holeCount; i++) indices.push(i);
    const players = [...state.players].sort((a, b) => total(a) - total(b));
    this.el.scoreTitle.textContent = final ? 'Sluttresultat' : `Hull ${state.holeIndex + 1} fullført`;

    const table = this.el.scoreTable;
    table.innerHTML = '';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.innerHTML = `<th class="name">Spiller</th>` +
      indices.map((i) => `<th>${i + 1}</th>`).join('') +
      `<th>Totalt</th>`;
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const parRow = document.createElement('tr');
    parRow.className = 'par';
    const pars = indices.map((i) => course.holes[i]?.par ?? 0);
    parRow.innerHTML = `<td class="name">Par</td>` + pars.map((p) => `<td>${p}</td>`).join('') +
      `<td class="total">${pars.reduce((a, b) => a + b, 0)}</td>`;
    tbody.appendChild(parRow);

    players.forEach((p, rank) => {
      const tr = document.createElement('tr');
      if (p.id === myId) tr.className = 'me';
      const cells = [];
      for (const i of indices) {
        const s = p.scores[i];
        const par = course.holes[i]?.par ?? 0;
        let cls = i === state.holeIndex ? 'cur' : '';
        if (s != null && s < par) cls += ' under';
        if (s != null && s > par) cls += ' over';
        cells.push(`<td class="${cls.trim()}">${s == null ? '–' : s}</td>`);
      }
      const trophy = final && rank === 0 ? '<span class="trophy">🏆</span>' : '';
      tr.innerHTML = `<td class="name"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)} ${trophy}</td>` +
        cells.join('') + `<td class="total">${total(p)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const isHost = state.hostId === myId;
    this.el.again.hidden = !(final && isHost);
    this.el.toLobby.hidden = !(final && isHost);
    this.el.scoreFooter.textContent = final
      ? isHost ? 'Spill banen igjen eller gå tilbake til lobbyen.' : 'Venter på verten…'
      : 'Neste hull starter snart…';
  }

  // Optional second line (`sub`) for story beats; those toasts stay a bit longer.
  toast(text, sub) {
    const div = document.createElement('div');
    div.className = 'toast' + (sub ? ' two' : '');
    div.textContent = text;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = sub;
      div.appendChild(s);
    }
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), sub ? 5200 : 3300);
  }
}

function total(p) {
  return (p.scores ?? []).reduce((a, s) => a + (s ?? 0), 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
