// Web server: HTTP routes for actions, Socket.IO for live updates (spec 33).
//
// The server is the only authority. Phones send requests ("register me", "approve this");
// the server checks them against the database and pushes the result back out. Nothing a
// phone sends over Socket.IO can change data: sockets are receive-only for clients.

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const { parseCookies } = require('./auth');
const { createGame } = require('./game');
const { createPlayers, publicView } = require('./players');
const { createBanker } = require('./banker');
const { createPresence } = require('./presence');
const { createPoints } = require('./points');
const { createWallet } = require('./wallet');
const { createRounds } = require('./rounds');
const { createSimHardware, createSimVision } = require('./sim');
const { joinQrSvg, watchNetwork } = require('./network');
const { createResets } = require('./resets');

const PLAYER_COOKIE = 'by_player';
const BANKER_COOKIE = 'by_banker';
const YEAR_S = 365 * 24 * 3600;

function cookie(name, value, { maxAge, sameSite }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

// hardware / vision default to the simulated ones until Phases 5-6 provide real drivers.
// backupDir: where resets put their safety copy of the database.
// network: options for the hotspot watcher, or false to turn it off (tests).
function createApp({
  db, port, graceMs, log = console.log, hardware, vision, bootId,
  backupDir = require('os').tmpdir(), network = {},
}) {
  hardware ??= createSimHardware({ log });
  vision ??= createSimVision();
  const game = createGame(db);
  const wallet = createWallet(db);
  const points = createPoints(db, game, wallet);
  const players = createPlayers(db, game, { onRegistered: points.grantStartingCredit });
  const banker = createBanker(db);

  // Going inactive (banker, or 2-minute timeout) also cancels any pending point request
  // and releases reserved points, all in one transaction (spec 18.4).
  const deactivate = db.transaction((id) => {
    const r = players.deactivate(id);
    if (!r.ok) return r;
    return { ...r, cancelled: points.cancelPendingFor(id) };
  }).immediate;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  const server = http.createServer(app);
  const io = new Server(server);

  const rounds = createRounds({
    db, game, wallet, hardware, vision, log, bootId,
    onChange: () => pushEverything(),
    onRoundEnded: () => finishQueuedLeaves(),
  });

  const resets = createResets({ db, game, banker, points, backupDir, log });

  // Hotspot lost for 10 s: stop like STOP does (cancel and refund an unfinished round) and
  // require CONFIRM SYSTEM READY once it is back (spec 29.2).
  const net = network === false ? null : watchNetwork({
    ...network,
    onLost() {
      log('network lost: halting the game');
      rounds.halt('HOTSPOT_LOST');
    },
    onBack(ip) {
      log(`network back (${ip})`);
      pushBanker();
    },
  });

  const presence = createPresence({
    graceMs,
    onTimeout(id) {
      const r = deactivate(id);
      if (r.ok) {
        log(`player ${id} inactive after disconnect timeout`);
        if (r.cancelled) notify(id, r.cancelled.notice);
        pushPlayer(id);
        pushStatus();
        pushBanker();
      }
    },
  });

  // ---- live updates -------------------------------------------------------------------

  function statusView() {
    return {
      ...rounds.publicStatus(),
      registrationOpen: game.isBetweenRounds(),
      gameFull: players.activeCount() >= players.MAX_ACTIVE,
    };
  }

  function overview() {
    const list = players.list().map((p) => ({
      ...p,
      available: p.balance - p.reserved,
      connected: presence.isConnected(p.id),
    }));
    return {
      ...statusView(),
      activeCount: players.activeCount(),
      maxActive: players.MAX_ACTIVE,
      players: list,
      pendingReactivations: list.filter((p) => p.status === 'INACTIVE' && p.reactivation_requested_at),
      pendingRequests: points.listPending(),
      transactions: points.recentTransactions(50),
      startingBalance: points.getStartingBalance(),
      walletCheck: points.audit(),
      game: { ...rounds.bankerView(), camera: vision.lastResult?.() || null },
      adminLog: resets.recentLog(),
    };
  }

  // Everything one player may see about themselves (never other players: spec 26.5).
  function meView(id) {
    const p = players.get(id);
    if (!p) return null;
    return { ...publicView(p), request: points.latestRequest(id), bet: rounds.playerBet(id) };
  }

  const pushStatus = () => io.to('public').emit('status', statusView());
  const pushPlayer = (id) => io.to(`player:${id}`).emit('me', meView(id));
  // Small silent message shown for 5 seconds on that player's phone (spec 25).
  const notify = (id, text) => io.to(`player:${id}`).emit('notice', { text });
  const pushBanker = () => io.to('banker').emit('overview', overview());
  // Round changes affect everyone: each connected player gets their own bet/wallet view.
  function pushEverything() {
    pushStatus();
    for (const room of io.of('/').adapter.rooms.keys()) {
      if (room.startsWith('player:')) pushPlayer(Number(room.slice(7)));
    }
    pushBanker();
  }

  // Players who pressed LEAVE GAME during the round leave now that it has ended (spec 18.3),
  // after their payout or refund has been made.
  function finishQueuedLeaves() {
    for (const id of players.queuedLeaves()) {
      const r = deactivate(id);
      if (!r.ok) continue;
      log(`player ${id} left the game after the round ended`);
      if (r.cancelled) notify(id, r.cancelled.notice);
    }
  }

  io.on('connection', (socket) => {
    const c = parseCookies(socket.handshake.headers.cookie);
    socket.join('public');
    socket.emit('status', statusView());

    const player = players.findBySession(c[PLAYER_COOKIE]);
    if (player) {
      socket.join(`player:${player.id}`);
      presence.connected(player.id);
      players.touchSeen(player.id);
      socket.emit('me', meView(player.id));
      pushBanker();
      socket.on('disconnect', () => {
        presence.disconnected(player.id);
        players.touchSeen(player.id);
        pushBanker();
      });
    }

    if (banker.isValidSession(c[BANKER_COOKIE])) {
      socket.join('banker');
      socket.emit('overview', overview());
    }
  });

  // ---- helpers ------------------------------------------------------------------------

  function send(res, result, okStatus = 200) {
    if (result.ok) return res.status(okStatus).json(result);
    return res.status(result.code === 'NO_SESSION' ? 401 : 400).json(result);
  }

  function requirePlayer(req, res, next) {
    const p = players.findBySession(req.cookies[PLAYER_COOKIE]);
    if (!p) return send(res, { ok: false, code: 'NO_SESSION', message: 'Please register first.' });
    req.player = p;
    next();
  }

  function requireBanker(req, res, next) {
    if (!banker.isValidSession(req.cookies[BANKER_COOKIE])) {
      return send(res, { ok: false, code: 'NO_SESSION', message: 'Banker login required.' });
    }
    next();
  }

  // ---- player routes ------------------------------------------------------------------

  app.get('/api/status', (_req, res) => res.json({ ok: true, ...statusView() }));

  app.post('/api/register', (req, res) => {
    // Already registered on this browser: never create a second account (spec 14.6).
    const existing = players.findBySession(req.cookies[PLAYER_COOKIE]);
    if (existing) return send(res, { ok: true, me: meView(existing.id) });

    const r = players.register(req.body?.nickname);
    if (!r.ok) return send(res, r);
    res.setHeader('Set-Cookie', cookie(PLAYER_COOKIE, r.token, { maxAge: YEAR_S, sameSite: 'Lax' }));
    log(`registered player ${r.player.id} ${r.player.nickname}`);
    presence.expectConnection(r.player.id);
    pushStatus();
    pushBanker();
    send(res, { ok: true, me: meView(r.player.id) }, 201);
  });

  app.get('/api/me', requirePlayer, (req, res) => send(res, { ok: true, me: meView(req.player.id) }));

  for (const [path, fn] of [['purchase', points.requestPurchase], ['redeem', points.requestRedemption]]) {
    app.post(`/api/points/${path}`, requirePlayer, (req, res) => {
      const r = fn(req.player.id, req.body?.amount);
      if (r.ok) {
        log(`player ${req.player.id} requested ${r.request.type} ${r.request.amount}`);
        pushPlayer(req.player.id);
        pushBanker();
      }
      send(res, r.ok ? { ok: true, me: meView(req.player.id) } : r);
    });
  }

  app.post('/api/bet', requirePlayer, (req, res) => {
    const r = rounds.placeBet(req.player.id, {
      roundId: req.body?.roundId, color: req.body?.color, amount: req.body?.amount,
    });
    if (r.ok) {
      pushPlayer(req.player.id);
      pushBanker();
    }
    send(res, r.ok ? { ok: true, me: meView(req.player.id) } : r);
  });

  // LEAVE GAME (spec 18). Between rounds: inactive now. During a round: queued; the bet
  // stays valid and the exit completes once the round is settled or cancelled.
  app.post('/api/leave', requirePlayer, (req, res) => {
    const id = req.player.id;
    if (req.player.status !== 'ACTIVE') {
      return send(res, { ok: false, code: 'NOT_ACTIVE', message: 'You have already left the game.' });
    }
    let left = false;
    if (game.isBetweenRounds()) {
      const r = deactivate(id);
      if (!r.ok) return send(res, r);
      left = true;
      log(`player ${id} left the game`);
    } else {
      players.queueLeave(id);
      log(`player ${id} will leave after this round`);
    }
    pushPlayer(id);
    pushStatus();
    pushBanker();
    send(res, { ok: true, left, me: meView(id) });
  });

  app.post('/api/reactivation', requirePlayer, (req, res) => {
    const r = players.requestReactivation(req.player.id);
    if (r.ok) {
      pushPlayer(req.player.id);
      pushBanker();
    }
    send(res, r);
  });

  // ---- banker routes ------------------------------------------------------------------

  app.get('/api/banker/session', (req, res) => {
    res.json({
      ok: true,
      loggedIn: banker.isValidSession(req.cookies[BANKER_COOKIE]),
      accountExists: banker.exists(),
    });
  });

  app.post('/api/banker/login', async (req, res) => {
    const token = banker.login(req.body?.username, req.body?.password);
    if (!token) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down password guessing
      return send(res, { ok: false, code: 'BAD_LOGIN', message: 'Wrong username or password.' });
    }
    res.setHeader('Set-Cookie', cookie(BANKER_COOKIE, token, { maxAge: 12 * 3600, sameSite: 'Strict' }));
    log('banker logged in');
    send(res, { ok: true });
  });

  app.post('/api/banker/logout', (req, res) => {
    banker.logout(req.cookies[BANKER_COOKIE]);
    res.setHeader('Set-Cookie', cookie(BANKER_COOKIE, '', { maxAge: 0, sameSite: 'Strict' }));
    io.in('banker').disconnectSockets();
    send(res, { ok: true });
  });

  app.get('/api/banker/overview', requireBanker, (_req, res) => res.json({ ok: true, ...overview() }));

  // Final-position snapshot from the camera (spec 6.4, 8.7); in memory only, never stored.
  app.get('/api/banker/snapshot', requireBanker, (_req, res) => {
    const jpg = vision.lastSnapshot?.();
    if (!jpg) return res.status(404).json({ ok: false, code: 'NO_SNAPSHOT', message: 'No snapshot yet.' });
    res.set('Cache-Control', 'no-store').type('image/jpeg').send(jpg);
  });

  app.get('/api/banker/qr', requireBanker, async (_req, res) => {
    res.json({ ok: true, ...(await joinQrSvg(port)) });
  });

  function playerAction(name, fn, after) {
    app.post(`/api/banker/players/:id/${name}`, requireBanker, (req, res) => {
      const id = Number(req.params.id);
      const r = fn(id);
      if (r.ok) {
        after?.(id, r);
        pushPlayer(id);
        pushStatus();
        pushBanker();
      }
      send(res, r);
    });
  }

  playerAction('approve-reactivation', players.approveReactivation, (id, r) => {
    presence.expectConnection(id);
    for (const other of r.autoRejected) pushPlayer(other);
    log(`banker reactivated player ${id}` + (r.autoRejected.length ? `; auto-rejected ${r.autoRejected}` : ''));
  });
  playerAction('reject-reactivation', players.rejectReactivation);
  playerAction('deactivate', (id) => (game.isBetweenRounds()
    ? deactivate(id)
    : { ok: false, code: 'NOT_BETWEEN_ROUNDS', message: 'This can only be done between rounds.' }),
  (id, r) => { if (r.cancelled) notify(id, r.cancelled.notice); });

  // Approve / reject / cancel a pending top-up or redemption. A second click on an
  // already-handled request changes nothing and reports the request's real status.
  app.post('/api/banker/requests/:id/:action', requireBanker, (req, res) => {
    const { action } = req.params;
    if (!['approve', 'reject', 'cancel'].includes(action)) {
      return send(res, { ok: false, code: 'NOT_FOUND', message: 'Unknown request.' });
    }
    const r = points.decide(Number(req.params.id), action);
    if (r.ok) {
      log(`banker ${action} request ${r.request.id} (${r.request.type} ${r.request.amount})`);
      notify(r.playerId, r.notice);
      pushPlayer(r.playerId);
      pushBanker();
    }
    send(res, r);
  });

  // Game controls (spec 27.2). The round engine checks each one against the current state.
  const GAME_ACTIONS = {
    'confirm-system-ready': () => rounds.confirmSystemReady(),
    'start-round': () => rounds.startRound(),
    'close-betting': () => rounds.closeBetting(),
    drop: (b) => rounds.drop({ sim: b.sim }),
    'retry-scan': (b) => rounds.retryScan({ sim: b.sim }),
    'confirm-result': (b) => rounds.confirmResult(b.color),
    'retry-drop': () => rounds.retryDrop(),
    'cancel-round': () => rounds.cancelRound(),
    'confirm-ready': () => rounds.confirmReady(),
    resume: () => rounds.resume(),
    stop: () => rounds.stop(),
  };

  app.post('/api/banker/game/:action', requireBanker, (req, res) => {
    const fn = GAME_ACTIONS[req.params.action];
    if (!fn) return send(res, { ok: false, code: 'NOT_FOUND', message: 'Unknown game action.' });
    const r = fn(req.body || {});
    if (r.ok) pushEverything();
    send(res, r);
  });

  // Reset modes (spec 31). Password re-entered every time; the server checks the game is
  // idle and makes a backup first.
  app.post('/api/banker/reset/:mode', requireBanker, async (req, res) => {
    const { mode } = req.params;
    let r;
    if (mode === 'points') r = await resets.resetPoints(req.body?.password, { regrant: req.body?.regrant !== false });
    else if (mode === 'players') r = await resets.resetPlayers(req.body?.password);
    else return send(res, { ok: false, code: 'NOT_FOUND', message: 'Unknown reset.' });
    if (r.ok) {
      if (mode === 'players') {
        // Deleted accounts: tell their phones to reload (back to the sign-up form) and drop
        // the old connections so a reused player id can never reach an old phone.
        for (const room of [...io.of('/').adapter.rooms.keys()]) {
          if (room.startsWith('player:')) {
            io.to(room).emit('reset');
            io.in(room).disconnectSockets();
          }
        }
      }
      pushEverything();
    }
    send(res, r);
  });

  app.post('/api/banker/settings/starting-balance', requireBanker, (req, res) => {
    const r = points.setStartingBalance(req.body?.value);
    if (r.ok) {
      log(`starting balance set to ${r.startingBalance}`);
      pushBanker();
    }
    send(res, r);
  });

  // ---- pages and errors ---------------------------------------------------------------

  const pub = path.join(__dirname, '..', 'public');
  app.get('/banker', (_req, res) => res.sendFile(path.join(pub, 'banker.html')));
  app.use(express.static(pub));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Unknown request.' }));
  app.use((err, _req, res, _next) => {
    log('error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Something went wrong on the server.' });
  });

  // ---- startup ------------------------------------------------------------------------

  banker.invalidateAllSessions();
  rounds.init();
  for (const id of players.activeIds()) presence.expectConnection(id);

  function close() {
    net?.stop();
    rounds.shutdown();
    presence.stop();
    io.close();
    server.close();
  }

  return { app, server, io, close, players, banker, game, points, rounds, resets };
}

module.exports = { createApp, PLAYER_COOKIE, BANKER_COOKIE };
