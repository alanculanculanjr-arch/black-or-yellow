// Banker dashboard. Buttons send a request and stay disabled until the server answers
// (spec 24.1); the tables are redrawn from the server's live 'overview' updates.

const $ = (id) => document.getElementById(id);
let socket = null;
let qrTimer = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ ok: false, message: 'No response from the server.' }));
}

function setMsg(el, text, kind) {
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

function actionButton(label, url, cls = '') {
  const b = el('button', { textContent: label, className: cls });
  b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await api(url, {});
    if (!r.ok) {
      setMsg($('action-msg'), r.message, 'error');
      b.disabled = false; // the live update redraws the table on success
    } else {
      setMsg($('action-msg'), '');
    }
  });
  return b;
}

const REASON_TEXT = {
  SERVER_RESTART: 'The server restarted. The unfinished round was cancelled and all its bets refunded.',
  CAMERA_LOST: 'The camera was lost. The round was cancelled and refunded. Check the camera phone.',
  STOPPED: 'STOP was pressed. Any unfinished round was cancelled and refunded.',
  HARDWARE_FAULT: 'A hardware error stopped the game. Any unfinished round was cancelled and refunded.',
  TIMEOUT: 'Detection timed out: no still ball found within 10 seconds.',
  INVALID: 'Invalid landing: outside the board or between cells.',
  INTERRUPTED: 'The drop or scan was interrupted by the restart.',
  RECOVERY_FAILED: 'Automatic ball recovery failed. Return the ball by hand.',
  HOTSPOT_LOST: 'The Pi lost the Wi-Fi hotspot. Any unfinished round was cancelled and refunded. Check the hotspot phone.',
};

// Actions that need a second "are you sure?" (spec 36: clear confirmation dialogs).
const CONFIRM_TEXT = {
  'confirm-system-ready': 'Have you checked the board, the ball (at the release point), the camera and the hardware?',
  'cancel-round': 'Cancel this round? Every bet will be refunded.',
  'retry-drop': 'Recover the ball and drop again? Bets stay as they are.',
  'confirm-ready': 'Is the ball back at the release position?',
  stop: 'STOP the game now? Motors stop and an unfinished round is cancelled and refunded.',
  resume: 'Resume the interrupted round?',
};

const ACTION_LABEL = {
  'confirm-system-ready': 'Confirm system ready',
  'start-round': 'Start round',
  'close-betting': 'Close betting',
  drop: 'DROP',
  'retry-scan': 'Retry scan',
  'retry-drop': 'Retry drop',
  'cancel-round': 'Cancel round',
  'confirm-ready': 'Confirm ready',
  resume: 'Resume round',
  stop: 'STOP',
};

function gameButton(action, label, body = {}, cls = '', confirmText = CONFIRM_TEXT[action]) {
  const b = el('button', { textContent: label, className: cls });
  b.addEventListener('click', async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    b.disabled = true;
    const r = await api(`/api/banker/game/${action}`, { ...body, sim: $('sim').value });
    b.disabled = false;
    setMsg($('action-msg'), r.ok ? '' : r.message, r.ok ? '' : 'error');
  });
  return b;
}

function chip(color) {
  return el('span', { className: 'chip ' + color, textContent: color });
}

const STEPS = ['Start', 'Betting', 'Drop', 'Confirm', 'Ball return'];
const STEP_OF = {
  IDLE: 0, BETTING_OPEN: 1, BETTING_CLOSED: 2, DROPPING: 2, DETECTING: 2, DETECTION_FAILED: 2,
  AWAITING_RESULT_CONFIRMATION: 3, BALL_RECOVERY: 4, AWAITING_BALL_READY: 4,
};

const nice = (state) => (state || '').replaceAll('_', ' ').toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What is happening, what the banker should do next, and which button does it.
// kind: '' (your move), 'wait' (nothing to press), 'bad' (something went wrong).
function guide(o) {
  const g = o.game;
  const r = g.round && g.round.current ? g.round : null;
  const bets = r ? r.bets.length : 0;
  const has = (a) => g.actions.includes(a);
  const why = g.reason && REASON_TEXT[g.reason] ? REASON_TEXT[g.reason] + ' ' : '';

  if (g.state === 'RECOVERY_REVIEW') {
    return {
      kind: 'bad', title: 'Interrupted round',
      text: `The Pi restarted during round #${r.id} while it was "${nice(g.interruptedState)}". ` +
        `${plural(bets, 'bet')} are still held. Look at the board, then Resume to carry on, or Cancel round to refund everyone.`,
      primary: 'resume',
    };
  }
  if (!g.systemReady && has('confirm-system-ready')) {
    return {
      kind: why ? 'bad' : '', title: 'Safety check first',
      text: why + 'Check that the board is clear, the ball is at the release point, the camera phone is streaming ' +
        'and the motors are safe. Then press Confirm system ready.' + (r ? ` Round #${r.id} continues after that.` : ''),
      primary: 'confirm-system-ready',
    };
  }
  switch (g.state) {
    case 'IDLE': {
      const last = g.round && !g.round.current ? g.round : null;
      const lastText = last ? (last.status === 'SETTLED' ? `Last round #${last.id}: ${last.final_color}. `
        : `Last round #${last.id} was cancelled and refunded. `) : '';
      return {
        kind: o.activeCount ? '' : 'wait', title: 'Ready for a new round',
        text: lastText + (o.activeCount ? `${plural(o.activeCount, 'active player')}. Press Start round to open betting.`
          : 'No active players yet. Let players scan the QR code below, then press Start round.'),
        primary: 'start-round',
      };
    }
    case 'BETTING_OPEN':
      return {
        kind: '', title: 'Players are betting',
        text: `${plural(bets, 'bet')} so far. When everyone who wants to bet has done so, press Close betting. ` +
          'After that nobody can bet in this round.',
        primary: 'close-betting',
      };
    case 'BETTING_CLOSED':
      if (!bets) {
        return {
          kind: 'bad', title: 'Nobody bet',
          text: 'DROP needs at least one bet. Cancel this round and start a new one.', primary: 'cancel-round',
        };
      }
      return {
        kind: '', title: r.drop_attempts ? `Ready to drop again (attempt ${r.drop_attempts + 1})` : 'Ready to drop',
        text: `${plural(bets, 'bet')} locked. Make sure the ball is at the release point, then press DROP. ` +
          'The camera then watches where it lands.',
        primary: 'drop',
      };
    case 'DROPPING':
      return { kind: 'wait', title: 'Dropping the ball…', text: 'The trapdoor is opening. Nothing to press.' };
    case 'DETECTING':
      return {
        kind: 'wait', title: 'Watching the ball…',
        text: 'Waiting for the ball to stay still for 2 seconds (gives up after 10). Nothing to press.',
      };
    case 'DETECTION_FAILED':
      if (!has('retry-scan')) {
        return {
          kind: 'bad', title: 'Invalid landing', primary: 'retry-drop',
          text: why + 'Retry drop brings the ball back and drops it again; the same bets stay. Or cancel to refund everyone.',
        };
      }
      return {
        kind: 'bad', title: 'No result yet', primary: 'retry-scan',
        text: why + 'If the ball has stopped on the board, Retry scan looks again. If it is stuck or off the board, ' +
          'use Retry drop, or Cancel round to refund everyone.',
      };
    case 'AWAITING_RESULT_CONFIRMATION':
      return {
        kind: '', title: 'Check the result',
        text: `The camera says cell ${r.detected_cell}, which is ${r.detected_color}. Look at the board. ` +
          `If that's right, confirm it and ${r.detected_color} bets get paid. If not, use Correct to ` +
          `${r.detected_color === 'BLACK' ? 'YELLOW' : 'BLACK'}.`,
        primary: 'confirm-result',
      };
    case 'BALL_RECOVERY': {
      const paid = g.round && g.round.status === 'SETTLED' ? `Round #${g.round.id} paid out on ${g.round.final_color}. ` : '';
      return { kind: 'wait', title: 'Returning the ball…', text: paid + 'The board tilts and the blower runs. Nothing to press.' };
    }
    case 'AWAITING_BALL_READY': {
      const again = r && r.status === 'OPEN';
      return {
        kind: why ? 'bad' : '', title: 'Is the ball back?', primary: 'confirm-ready',
        text: why + 'Look at the release point. If the ball is there, press Confirm ready' +
          (again ? ', then you can DROP again.' : ' and the game is ready for the next round.') +
          ' If not, put it back by hand first.',
      };
    }
    default:
      return { kind: 'wait', title: nice(g.state), text: '' };
  }
}

function renderGame(o) {
  const g = o.game;
  const r = g.round;
  const current = r && r.current ? r : null;
  $('state').textContent = nice(g.state);
  $('round-no').textContent = current ? `#${current.id}` : '–';

  // Progress through the round.
  let step = STEP_OF[g.state === 'RECOVERY_REVIEW' ? g.interruptedState : g.state] ?? 0;
  if (current && current.status === 'OPEN' && step === 4) step = 2; // retry drop: back to dropping
  $('steps').replaceChildren(...STEPS.map((name, i) => el('li', {
    textContent: name, className: i < step ? 'done' : i === step ? 'now' : '',
  })));

  const gd = guide(o);
  $('next').className = 'next' + (gd.kind ? ' ' + gd.kind : '');
  $('next-title').textContent = gd.title;
  $('next-text').replaceChildren(gd.text);

  // The one big button for the usual next move; everything else smaller underneath.
  const primary = $('primary');
  const others = $('actions');
  primary.replaceChildren();
  others.replaceChildren();
  for (const a of g.actions) {
    if (a === 'stop') continue;
    const main = a === gd.primary;
    if (a === 'confirm-result') {
      const detected = current.detected_color;
      const other = detected === 'BLACK' ? 'YELLOW' : 'BLACK';
      primary.append(gameButton('confirm-result', `Confirm ${detected}`, { color: detected }, '', null));
      others.append(gameButton('confirm-result', `Correct to ${other}`, { color: other }, 'secondary',
        `The camera saw ${detected}. Change the result to ${other} and pay ${other} bets?`));
      continue;
    }
    (main ? primary : others).append(gameButton(a, ACTION_LABEL[a] || a, {}, main ? '' : 'secondary'));
  }
  $('stop-slot').replaceChildren(gameButton('stop', 'STOP', {}, 'danger'));

  // Camera snapshot of the final ball position (spec 6.4): shown while the banker decides.
  const cam = g.camera;
  const showCam = !g.simulated && cam && ['AWAITING_RESULT_CONFIRMATION', 'DETECTION_FAILED'].includes(g.state);
  $('camera-box').hidden = !showCam;
  if (showCam) {
    const what = cam.status === 'OK' ? `${cam.colour} (cell ${cam.cell}) · ${cam.shares}`
      : cam.status === 'INVALID' ? `Too close to call · ${cam.shares}` : cam.status.replaceAll('_', ' ').toLowerCase();
    $('camera-text').textContent = `Camera: ${what}`;
    const src = `/api/banker/snapshot?t=${cam.at}`;
    if ($('snapshot').getAttribute('src') !== src) $('snapshot').src = src;
  }

  $('sim-row').hidden = !(g.simulated && (g.actions.includes('drop') || g.actions.includes('retry-scan')));

  // Bets in the current (or last) round: the banker may see everything (spec 26.5).
  $('bets-card').hidden = !r;
  if (r) {
    const label = r.current ? `Bets: round #${r.id}` : `Last round #${r.id} (${r.status.toLowerCase()}` +
      (r.final_color ? `: ${r.final_color}` : '') + ')';
    $('bets-title').textContent = label;
    $('bet-totals').textContent = `BLACK: ${r.totals.BLACK.count} bets, ${r.totals.BLACK.amount} pts · ` +
      `YELLOW: ${r.totals.YELLOW.count} bets, ${r.totals.YELLOW.amount} pts`;
    $('bets').tBodies[0].replaceChildren(...r.bets.map((b) => el('tr', {}, [
      el('td', { textContent: b.nickname }),
      el('td', {}, [chip(b.color)]),
      el('td', { textContent: String(b.amount) }),
      el('td', { textContent: b.status }),
    ])));
  }
}

function renderOverview(o) {
  renderGame(o);
  $('active-count').textContent = `${o.activeCount} / ${o.maxActive}`;

  const lastReset = (o.adminLog || [])[0];
  $('admin-log').textContent = lastReset
    ? `Last reset: ${lastReset.action === 'RESET_POINTS' ? 'points' : 'all players'}, ` +
      `${new Date(lastReset.created_at.replace(' ', 'T') + 'Z').toLocaleString()}.`
    : '';

  const wc = o.walletCheck;
  $('wallet-check').className = wc.ok ? 'check-ok' : 'check-bad';
  $('wallet-check').textContent = wc.ok
    ? 'Wallet check: all balances match the transaction log.'
    : `Wallet check FAILED for: ${[...wc.ledger, ...wc.reserved].map((p) => p.nickname).join(', ')}. Stop and investigate.`;

  const pr = $('point-requests').tBodies[0];
  pr.replaceChildren(...o.pendingRequests.map((r) => el('tr', {}, [
    el('td', { textContent: r.nickname }),
    el('td', { textContent: r.type === 'PURCHASE' ? 'Top-up' : 'Redeem' }),
    el('td', { textContent: `${r.amount} pts` }),
    el('td', { textContent: String(r.balance) }),
    el('td', {}, [actionButton('Approve', `/api/banker/requests/${r.id}/approve`)]),
    el('td', {}, [actionButton('Reject', `/api/banker/requests/${r.id}/reject`, 'secondary')]),
    el('td', {}, [actionButton('Cancel', `/api/banker/requests/${r.id}/cancel`, 'secondary')]),
  ])));
  $('no-point-requests').hidden = o.pendingRequests.length > 0;
  $('point-requests').hidden = !o.pendingRequests.length;

  if (document.activeElement !== $('start-amount')) $('start-amount').value = String(o.startingBalance);

  const tx = $('transactions').tBodies[0];
  tx.replaceChildren(...o.transactions.map((t) => el('tr', {}, [
    el('td', { textContent: new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString() }),
    el('td', { textContent: t.nickname }),
    el('td', { textContent: t.type }),
    el('td', { textContent: (t.amount > 0 ? '+' : '') + t.amount, className: t.amount > 0 ? 'plus' : 'minus' }),
    el('td', { textContent: String(t.balance_after) }),
  ])));
  $('no-transactions').hidden = o.transactions.length > 0;
  $('transactions').hidden = !o.transactions.length;

  const req = $('requests').tBodies[0];
  req.replaceChildren(...o.pendingReactivations.map((p) => el('tr', {}, [
    el('td', { textContent: p.nickname }),
    el('td', {}, [actionButton('Approve', `/api/banker/players/${p.id}/approve-reactivation`)]),
    el('td', {}, [actionButton('Reject', `/api/banker/players/${p.id}/reject-reactivation`, 'secondary')]),
  ])));
  $('no-requests').hidden = o.pendingReactivations.length > 0;
  $('requests').hidden = !o.pendingReactivations.length;

  const tb = $('players').tBodies[0];
  tb.replaceChildren(...o.players.map((p) => {
    const active = p.status === 'ACTIVE';
    return el('tr', {}, [
      el('td', {}, [el('span', { className: 'dot' + (p.connected ? ' on' : ''), title: p.connected ? 'Online' : 'Offline' })]),
      el('td', { textContent: p.nickname }),
      el('td', {}, [el('span', { className: 'pill ' + (active ? 'active' : 'inactive'), textContent: active ? 'Active' : 'Inactive' })]),
      el('td', { textContent: p.reserved ? `${p.balance} (${p.reserved} held)` : String(p.balance) }),
      el('td', {}, active ? [actionButton('Deactivate', `/api/banker/players/${p.id}/deactivate`, 'secondary')] : []),
    ]);
  }));
  $('no-players').hidden = o.players.length > 0;
  $('players').hidden = !o.players.length;
}

async function refreshQr() {
  const r = await api('/api/banker/qr');
  if (!r.ok) return;
  $('qr').innerHTML = r.svg || '';
  $('join-url').textContent = r.url || 'The Pi has no network address right now.';
}

function showDashboard() {
  $('login').hidden = true;
  $('dash').hidden = false;
  $('logout-btn').hidden = false;
  socket = io();
  socket.on('connect', async () => {
    $('conn').textContent = 'live';
    // After a server restart every banker session is invalid (spec 29.3): back to login.
    const s = await api('/api/banker/session');
    if (!s.loggedIn) showLogin(s.accountExists);
  });
  socket.on('disconnect', () => { $('conn').textContent = 'reconnecting…'; });
  socket.on('overview', renderOverview);
  refreshQr();
  qrTimer = setInterval(refreshQr, 30000);
}

function showLogin(accountExists) {
  $('dash').hidden = true;
  $('login').hidden = false;
  $('logout-btn').hidden = true;
  $('no-account').hidden = accountExists;
  if (socket) socket.close();
  clearInterval(qrTimer);
}

$('sim').append(new Option('Random cell', 'random'));
for (let c = 1; c <= 16; c++) {
  const black = [1, 3, 6, 8, 9, 11, 14, 16].includes(c);
  $('sim').append(new Option(`Cell ${c} (${black ? 'BLACK' : 'YELLOW'})`, String(c)));
}
$('sim').append(new Option('Detection timeout', 'timeout'));
$('sim').append(new Option('Invalid landing', 'invalid'));
$('sim').append(new Option('Camera lost', 'camera-lost'));

for (let v = 0; v <= 100; v += 5) $('start-amount').append(new Option(`${v} pts`, v));

$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('start-btn').disabled = true;
  const r = await api('/api/banker/settings/starting-balance', { value: Number($('start-amount').value) });
  $('start-btn').disabled = false;
  setMsg($('action-msg'), r.ok ? `Starting points set to ${r.startingBalance}.` : r.message, r.ok ? 'ok' : 'error');
  $('start-amount').blur();
});

// ---- demo resets (spec 31) ----
const RESETS = {
  points: {
    title: 'Reset points and history?',
    what: ['Every wallet goes to 0 (or the starting points, if ticked).', 'All transactions, bets, rounds and point requests are erased.',
      'Players, nicknames and their phone logins stay.'],
    button: 'Reset points',
  },
  players: {
    title: 'Delete ALL players?',
    what: ['Every player account, wallet and history is deleted.', 'Nicknames become free to use again.',
      'Players will have to register again.', 'Banker login and settings stay.'],
    button: 'Delete all players',
  },
};
let resetMode = null;

function openReset(mode) {
  resetMode = mode;
  const r = RESETS[mode];
  $('reset-title').textContent = r.title;
  $('reset-what').replaceChildren(...r.what.map((t) => el('li', { textContent: t })));
  $('regrant-row').hidden = mode !== 'points';
  $('reset-go').textContent = r.button;
  $('reset-password').value = '';
  setMsg($('reset-dlg-msg'), '');
  $('reset-dialog').showModal();
}

$('reset-points-btn').addEventListener('click', () => openReset('points'));
$('reset-players-btn').addEventListener('click', () => openReset('players'));
$('reset-back').addEventListener('click', () => $('reset-dialog').close());
$('reset-go').addEventListener('click', async () => {
  $('reset-go').disabled = true;
  setMsg($('reset-dlg-msg'), 'Backing up and resetting…');
  const r = await api(`/api/banker/reset/${resetMode}`, { password: $('reset-password').value, regrant: $('regrant').checked });
  $('reset-go').disabled = false;
  $('reset-password').value = '';
  if (!r.ok) return setMsg($('reset-dlg-msg'), r.message, 'error');
  $('reset-dialog').close();
  setMsg($('reset-msg'), `Done (${r.players} players). Backup saved as ${r.backup}.`, 'ok');
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-btn').disabled = true;
  setMsg($('login-msg'), 'Checking…');
  const r = await api('/api/banker/login', { username: $('username').value, password: $('password').value });
  $('login-btn').disabled = false;
  $('password').value = '';
  if (!r.ok) return setMsg($('login-msg'), r.message, 'error');
  setMsg($('login-msg'), '');
  showDashboard();
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/banker/logout', {});
  showLogin(true);
});

api('/api/banker/session').then((s) => {
  $('loading').hidden = true;
  if (s.loggedIn) showDashboard();
  else showLogin(s.accountExists);
});
