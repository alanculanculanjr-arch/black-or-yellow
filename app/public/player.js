// Player page. Shows the sign-up form to new visitors and the wallet to registered players.
// All changes arrive from the server over Socket.IO; this page never decides anything itself.

const $ = (id) => document.getElementById(id);
let status = null;
let me; // undefined until the first /api/me answer, then null (not registered) or the player

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

const STATE_TEXT = {
  IDLE: 'Waiting for the banker to start a round.',
  BETTING_OPEN: 'Betting is open: pick a color and an amount.',
  BETTING_CLOSED: 'Betting is closed. The ball drops soon.',
  DROPPING: 'The ball is dropping…',
  DETECTING: 'Watching where the ball lands…',
  DETECTION_FAILED: 'The banker is checking the ball.',
  AWAITING_RESULT_CONFIRMATION: 'Waiting for the banker to confirm the result.',
  BALL_RECOVERY: 'Round finished. Getting the ball ready for the next round.',
  AWAITING_BALL_READY: 'Round finished. Getting the ball ready for the next round.',
  RECOVERY_REVIEW: 'The game was interrupted. The banker is checking the round.',
};

let pick = { color: null, amount: null };

function chip(color) {
  const c = document.createElement('span');
  c.className = 'chip ' + color;
  c.textContent = color;
  return c;
}

function renderGame(active) {
  const st = status || { state: 'IDLE' };
  $('round-title').textContent = st.roundId ? `Round ${st.roundId}` : 'Game';
  $('game-state').textContent = STATE_TEXT[st.state] || st.state;

  // Small result line: provisional first, final after the banker confirms (spec 26.3-26.4).
  const res = $('result');
  res.replaceChildren();
  if (st.provisional) {
    res.append('Provisional: ', chip(st.provisional), ' (awaiting banker confirmation)');
  } else if (st.lastResult && !st.roundId) {
    if (st.lastResult.status === 'SETTLED') res.append(`Round ${st.lastResult.roundId} result: `, chip(st.lastResult.color));
    else res.append(`Round ${st.lastResult.roundId} was cancelled. Bets were refunded.`);
  } else if (st.lastResult && st.roundId && st.lastResult.roundId === st.roundId && st.lastResult.status === 'SETTLED') {
    res.append('Result: ', chip(st.lastResult.color));
  }
  res.hidden = !res.childNodes.length;

  // This player's own bet.
  const bet = me.bet;
  const myBet = $('my-bet');
  myBet.replaceChildren();
  const relevant = bet && (bet.roundId === st.roundId || (st.lastResult && bet.roundId === st.lastResult.roundId));
  if (relevant) {
    myBet.append(`Your bet: ${bet.amount} pts on `, chip(bet.color), ' ');
    const s = document.createElement('span');
    if (bet.status === 'LOCKED') s.textContent = '(locked)';
    if (bet.status === 'WON') { s.textContent = `You won ${bet.payout} pts!`; s.className = 'won'; }
    if (bet.status === 'LOST') { s.textContent = 'Not this time.'; s.className = 'lost'; }
    if (bet.status === 'REFUNDED') s.textContent = 'Refunded.';
    myBet.append(s);
  }
  myBet.hidden = !relevant;

  const canBet = active && !me.leaveQueued && st.state === 'BETTING_OPEN' && !(bet && bet.roundId === st.roundId);
  $('bet-area').hidden = !canBet;
  if (!canBet) pick = { color: null, amount: null };
  for (const b of document.querySelectorAll('[data-color]')) b.classList.toggle('selected', b.dataset.color === pick.color);
  for (const b of document.querySelectorAll('[data-amount]')) b.classList.toggle('selected', Number(b.dataset.amount) === pick.amount);
  $('bet-btn').disabled = !(pick.color && pick.amount);

  $('leave-btn').hidden = !active || me.leaveQueued;
  $('leave-queued').hidden = !(active && me.leaveQueued);
}

function render() {
  $('loading').hidden = true;

  if (!me) {
    $('register').hidden = false;
    $('player').hidden = true;
    let closed = '';
    if (status && !status.registrationOpen) closed = 'Registration Temporarily Closed';
    else if (status && status.gameFull) closed = 'Game Full';
    $('register-btn').disabled = Boolean(closed);
    if (closed) setMsg($('register-msg'), closed, 'error');
    else if ($('register-msg').textContent === 'Registration Temporarily Closed' ||
             $('register-msg').textContent === 'Game Full') setMsg($('register-msg'), '');
    return;
  }

  $('register').hidden = true;
  $('player').hidden = false;
  $('me-nickname').textContent = me.nickname;
  $('me-balance').textContent = me.available;
  const reserved = me.balance - me.available;
  $('me-reserved').hidden = reserved === 0;
  $('me-reserved').textContent = `${reserved} pts held for a pending redemption`;

  const active = me.status === 'ACTIVE';
  $('me-status').textContent = active ? 'Active' : 'Inactive';
  $('me-status').className = 'pill ' + (active ? 'active' : 'inactive');

  $('inactive-card').hidden = active;
  $('reactivate-btn').disabled = me.reactivationRequested;
  $('reactivate-btn').textContent = me.reactivationRequested ? 'Request sent: waiting for banker' : 'Request reactivation';

  renderStore(active);
  renderGame(active);
}

// ---- betting: choose, review, confirm (spec 11.3) ----
for (const b of document.querySelectorAll('[data-color]')) {
  b.addEventListener('click', () => { pick.color = b.dataset.color; setMsg($('bet-msg'), ''); render(); });
}
for (const b of document.querySelectorAll('[data-amount]')) {
  b.addEventListener('click', () => { pick.amount = Number(b.dataset.amount); setMsg($('bet-msg'), ''); render(); });
}
$('bet-btn').addEventListener('click', () => {
  $('dlg-amount').textContent = pick.amount;
  $('dlg-color').replaceChildren(chip(pick.color));
  $('bet-dialog').showModal();
});
$('dlg-back').addEventListener('click', () => $('bet-dialog').close());
$('dlg-confirm').addEventListener('click', async () => {
  $('dlg-confirm').disabled = true;
  const r = await api('/api/bet', { roundId: status && status.roundId, color: pick.color, amount: pick.amount });
  $('dlg-confirm').disabled = false;
  $('bet-dialog').close();
  if (!r.ok) {
    setMsg($('bet-msg'), r.message, 'error');
    return;
  }
  me = r.me;
  render();
});

// ---- leave game (spec 18) ----
$('leave-btn').addEventListener('click', () => $('leave-dialog').showModal());
$('leave-back').addEventListener('click', () => $('leave-dialog').close());
$('leave-confirm').addEventListener('click', async () => {
  $('leave-confirm').disabled = true;
  const r = await api('/api/leave', {});
  $('leave-confirm').disabled = false;
  $('leave-dialog').close();
  if (r.ok) {
    me = r.me;
    render();
  }
});

const TYPE_TEXT = { PURCHASE: 'Top-up', REDEMPTION: 'Redemption' };

function renderStore(active) {
  const req = me.request;
  $('req-status').hidden = !req;
  if (req) $('req-status').innerHTML = '';
  if (req) {
    $('req-status').append(`${TYPE_TEXT[req.type]} of ${req.amount} pts: `);
    const pill = document.createElement('span');
    pill.className = 'pill ' + (req.status === 'APPROVED' ? 'active' : req.status === 'PENDING' ? '' : 'inactive');
    pill.textContent = req.status;
    $('req-status').append(pill);
  }
  const pending = req && req.status === 'PENDING';
  const between = !status || status.registrationOpen;
  const blocked = !active || pending || !between;
  for (const id of ['buy-amount', 'buy-btn', 'redeem-amount', 'redeem-btn']) $(id).disabled = blocked;
  if (!active) setMsg($('store-msg'), '');
  else if (pending) setMsg($('store-msg'), 'Waiting for the banker to handle your request.');
  else if (!between) setMsg($('store-msg'), 'Point requests open again between rounds.');
  else if (['Waiting for the banker to handle your request.', 'Point requests open again between rounds.']
    .includes($('store-msg').textContent)) setMsg($('store-msg'), '');
}

for (let v = 5; v <= 100; v += 5) $('buy-amount').append(new Option(`${v} pts`, v));

async function submitRequest(path, amount, button) {
  button.disabled = true;
  setMsg($('store-msg'), 'Sending…');
  const r = await api(path, { amount });
  if (!r.ok) {
    setMsg($('store-msg'), r.message, 'error');
    button.disabled = false;
    return;
  }
  setMsg($('store-msg'), '');
  me = r.me;
  render();
}

$('buy-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitRequest('/api/points/purchase', Number($('buy-amount').value), $('buy-btn'));
});

$('redeem-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Number($('redeem-amount').value);
  if (!Number.isInteger(amount) || amount < 5 || amount % 5 !== 0) {
    setMsg($('store-msg'), 'Enter a multiple of 5, at least 5.', 'error');
    return;
  }
  if (amount > me.available) {
    setMsg($('store-msg'), 'You do not have enough available points for that.', 'error');
    return;
  }
  $('redeem-amount').value = '';
  submitRequest('/api/points/redeem', amount, $('redeem-btn'));
});

// Small, silent, disappears after 5 seconds (spec 25). The request's status stays
// visible in the Point Store card afterwards.
let toastTimer = null;
function showNotice(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = $('nickname').value.trim();
  if (!/^[A-Za-z0-9]{3,12}$/.test(nickname)) {
    setMsg($('register-msg'), 'Use 3–12 letters or numbers, no spaces or symbols.', 'error');
    return;
  }
  $('register-btn').disabled = true;
  setMsg($('register-msg'), 'Joining…');
  const r = await api('/api/register', { nickname });
  $('register-btn').disabled = false;
  if (!r.ok) {
    setMsg($('register-msg'), r.message, 'error');
    return;
  }
  me = r.me;
  render();
  // Reconnect so the live connection picks up the new login cookie.
  socket.disconnect().connect();
});

$('reactivate-btn').addEventListener('click', async () => {
  $('reactivate-btn').disabled = true;
  const r = await api('/api/reactivation', {});
  if (!r.ok) {
    setMsg($('reactivate-msg'), r.message, 'error');
    $('reactivate-btn').disabled = false;
  } else {
    setMsg($('reactivate-msg'), '');
  }
});

const socket = io();
socket.on('connect', () => { $('conn').textContent = 'live'; });
socket.on('disconnect', () => { $('conn').textContent = 'reconnecting…'; });
socket.on('status', (s) => { status = s; if (me !== undefined) render(); });
socket.on('me', (m) => { me = m; render(); });
socket.on('notice', (n) => showNotice(n.text));
// The banker deleted all players (demo reset): start again at the sign-up form.
socket.on('reset', () => location.reload());

// Initial load: are we already registered on this browser?
api('/api/me').then((r) => {
  me = r.ok ? r.me : null;
  render();
});
