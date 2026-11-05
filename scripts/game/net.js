// net.js - PeerJS networking for the game loader (host lobby + clients). Exposes GLNet.
// Load AFTER the PeerJS script and le_state.js (for character sanitizing), BEFORE gameloader.js.
//
// Model: the host is the authority. Clients connect to the host only (star topology), never to each other.
//
//   GLNet.host({ level, options? })      -> Promise<code>                  level is { name, data } (what the loader stores)
//   GLNet.connect({ hostCode, char })    -> Promise<{ level, id, players }>
//   GLNet.leave()                        -> Promise                         graceful: tells the other side first
//   GLNet.send(data)                     client: to the host. host: to every client.
//   GLNet.sendTo(id, data)               host only
//   GLNet.kick(id) / GLNet.setLocked(b)  host only
//   GLNet.players()                      [{ id, name, team, ping, host }]   id 0 is always the host
//   GLNet.on(event, fn) -> unsubscribe   events below
//   GLNet.role ("host"|"client"|null), .state, .code, .id, .level, .locked
//   GLNet.create(cfg)                    a separate instance (the test page runs host and client in one tab)
//
// Events: status {state, detail, role, code} | players [list] | join {player} | leave {player, reason}
//         message {from, data} | latency {id, ping} | notice "text" | error Error | closed {reason}
//
// Wire protocol (all messages are objects with a string `t`):
//   client -> host   hello {proto, char} | pong {ts} | ping {ts} | app {data} | leave
//   host -> client   welcome {proto, id, level, options, players} | reject {reason} | players {players}
//                    ping {ts} | pong {ts} | app {from, data} | bye {reason}

const GLNet = (() => {
    const PROTO = 1;
    const HOST_ID = 0;
    const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I; 32 chars so a random byte maps without bias

    const DEFAULTS = {
        prefix: "nr-",          // peer ids are prefix + code, so codes can't clash with other apps on the public broker
        codeLength: 5,
        maxPlayers: 8,          // including the host
        maxMsgBytes: 262144,    // incoming app messages larger than this (as JSON) are dropped
        brokerTimeout: 10000,   // time allowed to reach the PeerJS broker
        connectTimeout: 12000,  // client: time allowed for open + welcome. host: time allowed for a hello
        hostRetries: 5,         // new random code if one is taken
        pingEvery: 3000,
        silentTimeout: 12000,   // no traffic for this long = peer is gone
        relay: true,            // host re-broadcasts client app messages to the other clients
        cleanChar: null,        // (char) => cleanChar; defaults to LEState.cleanChar
        peerOptions: {},        // passed to new Peer(): host/port/path/key for your own broker, config.iceServers for TURN
    };

    const PEER_ERRORS = {
        "peer-unavailable": "HOST NOT FOUND",
        "unavailable-id": "CODE ALREADY IN USE",
        "invalid-id": "INVALID CODE",
        "network": "NETWORK ERROR",
        "server-error": "BROKER ERROR",
        "socket-error": "BROKER CONNECTION ERROR",
        "socket-closed": "BROKER CONNECTION CLOSED",
        "browser-incompatible": "BROWSER NOT SUPPORTED",
        "webrtc": "WEBRTC ERROR",
    };

    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const isMsg = m => !!m && typeof m === "object" && typeof m.t === "string";

    function randomCode(n) {
        const b = new Uint8Array(n);
        crypto.getRandomValues(b);
        return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
    }

    // PeerJS errors carry a `type`; turn them into short readable messages and keep the type for callers
    function peerErr(e) {
        const msg = PEER_ERRORS[e && e.type];
        if (!msg) return e instanceof Error ? e : new Error(String((e && e.message) || e));
        const err = new Error(msg);
        err.type = e.type;
        return err;
    }

    function create(userCfg) {
        const cfg = { ...DEFAULTS, ...userCfg, peerOptions: { ...DEFAULTS.peerOptions, ...(userCfg && userCfg.peerOptions) } };

        const handlers = {};
        let peer = null;
        let role = null;           // "host" | "client" | null
        let state = "idle";        // idle | opening | hosting | connecting | connected
        let code = null;
        let myId = null;
        let level = null;
        let options = {};
        let locked = false;
        let timers = [];

        // host side
        const players = new Map(); // id -> { id, name, team, char, conn, ping, lastSeen }
        let nextId = 1;

        // client side
        let hostConn = null;
        let roster = [];
        let lastHost = 0;

        // ---------- events ----------
        function on(ev, fn) {
            (handlers[ev] = handlers[ev] || []).push(fn);
            return () => off(ev, fn);
        }
        function off(ev, fn) {
            const a = handlers[ev];
            const i = a ? a.indexOf(fn) : -1;
            if (i >= 0) a.splice(i, 1);
        }
        function emit(ev, payload) {
            for (const fn of (handlers[ev] || []).slice()) {
                try { fn(payload); } catch (e) { console.error("[net] handler for", ev, e); }
            }
        }
        function setState(s, detail) {
            state = s;
            emit("status", { state: s, detail: detail || "", role, code });
        }

        // ---------- helpers ----------
        function safeSend(conn, msg) {
            if (!conn || !conn.open) return false;
            try { conn.send(msg); return true; } catch (e) { emit("error", peerErr(e)); return false; }
        }

        function sizeOk(data) {
            try { return JSON.stringify(data).length <= cfg.maxMsgBytes; } catch { return false; }
        }

        const clean = c => (cfg.cleanChar || LEState.cleanChar)(c);

        const pub = p => ({ id: p.id, name: p.name, team: p.team, ping: p.ping, host: false });
        const hostRoster = () => [{ id: HOST_ID, name: "HOST", team: 0, ping: 0, host: true }, ...[...players.values()].map(pub)];

        function openPeer(id) {
            return new Promise((resolve, reject) => {
                const p = id ? new Peer(id, cfg.peerOptions) : new Peer(cfg.peerOptions);
                const finish = (fn, v) => { clearTimeout(timer); p.off("open", onOpen); p.off("error", onErr); fn(v); };
                const onOpen = () => finish(resolve, p);
                const onErr = e => { try { p.destroy(); } catch {} finish(reject, peerErr(e)); };
                const timer = setTimeout(() => {
                    try { p.destroy(); } catch {}
                    finish(reject, new Error("BROKER TIMEOUT"));
                }, cfg.brokerTimeout);
                p.on("open", onOpen);
                p.on("error", onErr);
            });
        }

        // errors and signalling drops after the peer is up. Data connections survive a broker drop,
        // but new clients can't find the host until it reconnects.
        function wirePeer(p) {
            p.on("disconnected", () => {
                if (peer !== p || p.destroyed) return;
                emit("notice", "BROKER LINK LOST - RECONNECTING");
                setTimeout(() => { try { if (peer === p && !p.destroyed) p.reconnect(); } catch {} }, 1000);
            });
            p.on("error", e => { if (peer === p) emit("error", peerErr(e)); });
        }

        function teardown(reason, silent) {
            const wasActive = state !== "idle";
            state = "idle"; // first: close handlers below check the state and must not start a second teardown
            timers.forEach(clearInterval);
            timers = [];

            const conns = [...players.values()].map(p => p.conn);
            players.clear(); // first, so the close events below find nobody to remove
            if (hostConn) conns.push(hostConn);
            for (const c of conns) { try { c.close(); } catch {} }
            try { if (peer) peer.destroy(); } catch {}

            peer = null; hostConn = null; role = null; code = null; myId = null;
            level = null; options = {}; locked = false; nextId = 1; roster = [];

            if (!silent && wasActive) emit("closed", { reason });
            setState("idle", reason);
        }

        // ---------- host ----------
        async function host(o = {}) {
            if (state !== "idle") throw new Error("ALREADY ACTIVE");
            if (typeof Peer === "undefined") throw new Error("PEERJS NOT LOADED");
            if (!o.level) throw new Error("NO LEVEL");
            if (!cfg.cleanChar && typeof LEState === "undefined") throw new Error("LESTATE NOT LOADED");

            role = "host";
            level = o.level;
            options = o.options || {};
            myId = HOST_ID;
            setState("opening");

            try {
                let lastErr = null;
                for (let i = 0; i < cfg.hostRetries && !peer; i++) {
                    const c = randomCode(cfg.codeLength);
                    try { peer = await openPeer(cfg.prefix + c); code = c; } catch (e) {
                        lastErr = e;
                        if (e.type !== "unavailable-id") throw e;
                    }
                }
                if (!peer) throw lastErr || new Error("COULD NOT OPEN HOST");
            } catch (e) {
                teardown("host failed", true);
                throw e;
            }

            wirePeer(peer);
            peer.on("connection", onIncoming);
            timers.push(setInterval(hostTick, cfg.pingEvery));
            setState("hosting");
            return code;
        }

        function onIncoming(conn) {
            let player = null;
            const helloTimer = setTimeout(() => { if (!player) { try { conn.close(); } catch {} } }, cfg.connectTimeout);

            conn.on("data", raw => {
                if (!isMsg(raw)) return;
                if (!player) {
                    if (raw.t !== "hello") return;
                    clearTimeout(helloTimer);
                    player = admit(conn, raw);
                    return;
                }
                player.lastSeen = now();
                fromClient(player, raw);
            });

            const gone = () => { clearTimeout(helloTimer); if (player) removePlayer(player, "left"); };
            conn.on("close", gone);
            conn.on("error", gone);
        }

        function admit(conn, hello) {
            const refuse = reason => {
                safeSend(conn, { t: "reject", reason });
                setTimeout(() => { try { conn.close(); } catch {} }, 250); // let the reject get out first
                return null;
            };
            if (hello.proto !== PROTO) return refuse("VERSION MISMATCH");
            if (locked) return refuse("LOBBY LOCKED");
            if (players.size + 1 >= cfg.maxPlayers) return refuse("LOBBY FULL");

            const char = clean(hello.char); // never trust what a client sends
            const p = { id: nextId++, name: char.name, team: char.team, char, conn, ping: null, lastSeen: now() };
            players.set(p.id, p);

            safeSend(conn, { t: "welcome", proto: PROTO, id: p.id, level, options, players: hostRoster() });
            emit("join", { player: pub(p) });
            broadcastRoster();
            return p;
        }

        function fromClient(p, msg) {
            switch (msg.t) {
                case "pong":
                    if (typeof msg.ts === "number") {
                        p.ping = Math.max(0, Math.round(now() - msg.ts));
                        emit("latency", { id: p.id, ping: p.ping });
                    }
                    break;
                case "ping":
                    safeSend(p.conn, { t: "pong", ts: msg.ts });
                    break;
                case "app":
                    if (!sizeOk(msg.data)) return;
                    emit("message", { from: p.id, data: msg.data });
                    if (cfg.relay) broadcast({ t: "app", from: p.id, data: msg.data }, p.id);
                    break;
                case "leave":
                    removePlayer(p, "left");
                    break;
            }
        }

        function broadcast(msg, exceptId) {
            let n = 0;
            for (const p of players.values()) if (p.id !== exceptId && safeSend(p.conn, msg)) n++;
            return n;
        }

        function broadcastRoster() {
            const list = hostRoster();
            broadcast({ t: "players", players: list });
            emit("players", list);
        }

        function removePlayer(p, reason) {
            if (!players.has(p.id)) return;
            players.delete(p.id);
            try { p.conn.close(); } catch {}
            emit("leave", { player: pub(p), reason });
            broadcastRoster();
        }

        function hostTick() {
            const t = now();
            for (const p of [...players.values()]) {
                if (t - p.lastSeen > cfg.silentTimeout) { removePlayer(p, "timeout"); continue; }
                safeSend(p.conn, { t: "ping", ts: t });
            }
            if (players.size) broadcastRoster(); // carries the latest ping values
        }

        // ---------- client ----------
        async function connect(o = {}) {
            if (state !== "idle") throw new Error("ALREADY ACTIVE");
            if (typeof Peer === "undefined") throw new Error("PEERJS NOT LOADED");
            const hostCode = String(o.hostCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (hostCode.length !== cfg.codeLength) throw new Error("INVALID CODE");

            role = "client";
            code = hostCode;
            setState("connecting");

            try { peer = await openPeer(null); } catch (e) { teardown("connect failed", true); throw e; }

            return new Promise((resolve, reject) => {
                let done = false;
                const timer = setTimeout(() => fail(new Error("CONNECTION TIMED OUT")), cfg.connectTimeout);
                const fail = err => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    teardown("connect failed", true);
                    reject(err instanceof Error ? err : new Error(String(err)));
                };

                peer.on("error", e => { if (!done) fail(peerErr(e)); });

                const conn = peer.connect(cfg.prefix + hostCode, { reliable: true }); // ordered + reliable: the level arrives intact
                hostConn = conn;

                conn.on("open", () => safeSend(conn, { t: "hello", proto: PROTO, char: o.char }));
                conn.on("error", e => { if (!done) fail(peerErr(e)); else emit("error", peerErr(e)); });
                conn.on("close", () => {
                    if (!done) fail(new Error("HOST CLOSED THE CONNECTION"));
                    else if (state === "connected") teardown("HOST DISCONNECTED");
                });

                conn.on("data", msg => {
                    if (!isMsg(msg)) return;
                    lastHost = now();
                    switch (msg.t) {
                        case "welcome":
                            if (done) return;
                            done = true;
                            clearTimeout(timer);
                            myId = msg.id;
                            level = msg.level;
                            options = msg.options || {};
                            roster = Array.isArray(msg.players) ? msg.players : [];
                            wirePeer(peer);
                            timers.push(setInterval(() => {
                                if (now() - lastHost > cfg.silentTimeout) teardown("HOST TIMED OUT");
                            }, 1000));
                            setState("connected");
                            emit("players", roster);
                            resolve({ level, id: myId, players: roster, options });
                            break;
                        case "reject":
                            fail(new Error(String(msg.reason || "REJECTED")));
                            break;
                        case "players":
                            if (!Array.isArray(msg.players)) return;
                            roster = msg.players;
                            emit("players", roster);
                            break;
                        case "ping":
                            safeSend(conn, { t: "pong", ts: msg.ts });
                            break;
                        case "pong":
                            if (typeof msg.ts === "number") emit("latency", { id: HOST_ID, ping: Math.max(0, Math.round(now() - msg.ts)) });
                            break;
                        case "app":
                            if (done && sizeOk(msg.data)) emit("message", { from: msg.from, data: msg.data });
                            break;
                        case "bye":
                            if (done) teardown(String(msg.reason || "HOST CLOSED"));
                            break;
                    }
                });
            });
        }

        // ---------- shared actions ----------
        async function leave() {
            if (state === "idle") return;
            if (role === "host") broadcast({ t: "bye", reason: "HOST CLOSED" });
            else if (hostConn) safeSend(hostConn, { t: "leave" });
            await sleep(150); // give the goodbye time to leave before the connection is destroyed
            teardown("LEFT");
        }

        function send(data) {
            if (role === "host") return broadcast({ t: "app", from: HOST_ID, data }) > 0;
            if (role === "client" && state === "connected") return safeSend(hostConn, { t: "app", data });
            return false;
        }

        function sendTo(id, data) {
            const p = role === "host" ? players.get(id) : null;
            return p ? safeSend(p.conn, { t: "app", from: HOST_ID, data }) : false;
        }

        function kick(id) {
            const p = role === "host" ? players.get(id) : null;
            if (!p) return false;
            safeSend(p.conn, { t: "bye", reason: "KICKED" });
            setTimeout(() => removePlayer(p, "kicked"), 150);
            return true;
        }

        function setLocked(b) { if (role === "host") locked = !!b; return locked; }

        return {
            host, connect, leave, send, sendTo, kick, setLocked, on, off,
            players: () => (role === "host" ? hostRoster() : roster.slice()),
            get role() { return role; },
            get state() { return state; },
            get code() { return code; },
            get id() { return myId; },
            get level() { return level; },
            get locked() { return locked; },
            config: cfg,
        };
    }

    const api = create();
    api.create = create;
    return api;
})();

window.GLNet = GLNet; // top-level const isn't a window property, and gameloader.js looks it up on window
