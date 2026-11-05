// gametest.js - the game screen (screen-gm) in its connection-test form.
// The loader hands over through Store session.game = { mode: "solo"|"host"|"connect", level, char?, hostCode? }
// and the live connection stays in GLNet. This screen shows who is connected, lets you send messages, and checks
// that a joining client really received the host's level (both sides compute a hash of it).
// Replace this screen with the real game later; the GLNet calls below are the part to keep.

(function () {
    const GAME_PATH = "session.game";
    const $ = id => document.getElementById(id);

    let game = null;   // session.game
    let live = false;  // the session this screen was opened for is still active
    let lastRtt = null;
    let wired = false;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    // stable JSON (sorted keys) so the same level always hashes the same, then FNV-1a 32-bit
    function stable(v) {
        if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
        if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
        return JSON.stringify(v);
    }
    function levelHash(level) {
        const s = stable(level && level.data);
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(16).padStart(8, "0").toUpperCase();
    }

    const net = () => window.GLNet;
    const currentLevel = () => (live && net() && net().level) || (game && game.level) || null;

    // ---------- log ----------
    function log(text, bad) {
        const box = $("gm-log");
        const d = el("div", bad ? "gm-bad" : null, `${new Date().toLocaleTimeString()}  ${text}`);
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
    }

    const who = id => (id === 0 ? "HOST" : "P" + id);
    const dataText = d => (d && typeof d.text === "string" ? d.text : JSON.stringify(d));

    // ---------- rendering ----------
    function renderSession() {
        const box = $("gm-session");
        box.replaceChildren();
        if (!game) { box.appendChild(el("div", "le-empty", "NO SESSION - GO BACK TO THE LOADER")); return; }

        const lvl = currentLevel();
        const add = (name, stats) => {
            box.appendChild(el("div", "sl-char-card__name", name));
            if (stats) box.appendChild(el("div", "sl-char-card__stats", stats));
        };

        add(`MODE: ${game.mode.toUpperCase()}`, game.mode === "connect" ? `HOST CODE ${game.hostCode}` : "");
        if (lvl) {
            const d = lvl.data;
            add(`LEVEL: ${lvl.name}`, `${d.floors.length} FLOORS | ${d.connections.length} CONNECTIONS | HASH ${levelHash(lvl)}`);
        } else add("LEVEL: NONE");
        if (game.char) add(`CHARACTER: ${game.char.name}`, `HP ${game.char.chp}/${game.char.hp} | INT ${game.char.interface} | TEAM ${game.char.team}`);

        const canvas = $("gm-preview");
        if (canvas && window.GameLoader) GameLoader.drawPreview(canvas, lvl && lvl.data);
    }

    function renderNet() {
        const n = net();
        const host = game && game.mode === "host";
        const solo = game && game.mode === "solo";

        const code = n && n.code && live ? n.code : "";
        $("gm-code").textContent = code || (solo ? "SOLO" : "-----");
        $("gm-copy").style.display = host && code ? "" : "none";
        $("gm-lock").style.display = host && live ? "" : "none";
        if (host && n) $("gm-lock").textContent = "LOCK LOBBY: " + (n.locked ? "ON" : "OFF");

        let text;
        if (!game) text = "NO SESSION";
        else if (solo) text = "SOLO - NO NETWORK";
        else if (!live) text = "DISCONNECTED";
        else text = n.state.toUpperCase() + (lastRtt != null && !host ? ` - RTT ${lastRtt} MS` : "");
        const st = $("gm-status");
        st.textContent = text;
        st.style.color = game && !solo && !live ? "#ff4444" : "";

        $("gm-leave").textContent = live || solo ? "leave" : "back";
        $("gm-msg").disabled = !live;
        $("gm-send").classList.toggle("gl-disabled", !live);
    }

    function renderRoster(list) {
        const box = $("gm-roster");
        box.replaceChildren();
        const n = net();
        if (!list || !list.length) { box.appendChild(el("div", "sl-charlist__empty", game && game.mode === "solo" ? "SOLO" : "NOBODY")); return; }

        for (const p of list) {
            const card = el("div", "sl-char-card");
            const info = el("div", "sl-char-card__info");
            info.appendChild(el("div", "sl-char-card__name", p.name + (n && p.id === n.id ? " (YOU)" : "")));
            info.appendChild(el("div", "sl-char-card__stats", `ID ${p.id} | ${p.host ? "HOST" : "TEAM " + p.team} | ${p.ping == null ? "--" : p.ping + " MS"}`));
            card.appendChild(info);
            if (game && game.mode === "host" && !p.host) {
                const kick = el("div", "sl-char-btn sl-char-btn--delete", "KICK");
                kick.addEventListener("click", () => n.kick(p.id));
                card.appendChild(kick);
            }
            box.appendChild(card);
        }
    }

    function renderAll() {
        renderSession();
        renderNet();
        const n = net();
        if (live && n) renderRoster(n.players());
        else renderRoster(game && game.mode === "solo" ? [{ id: 0, name: game.char ? game.char.name : "PLAYER", team: game.char ? game.char.team : 0, host: true, ping: 0 }] : []);
    }

    // ---------- actions ----------
    function sendMsg() {
        const input = $("gm-msg");
        const text = input.value.trim();
        if (!text || !live) return;
        if (net().send({ text })) { log(`> ${text}`); input.value = ""; }
        else log("not sent (nobody to send to)", true);
    }

    async function leave() {
        const n = net();
        if (n && n.state !== "idle") await n.leave();
        Store.delete(GAME_PATH);
        showScreen("screen-gl");
    }

    function copyCode() {
        const code = net() && net().code;
        if (!code) return;
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => log("code copied"), () => log("copy failed - select it by hand", true));
        else log("copy not available here - select it by hand", true);
    }

    // ---------- wiring ----------
    function wire() {
        if (wired) return;
        wired = true;

        $("gm-leave").addEventListener("click", leave);
        $("gm-copy").addEventListener("click", copyCode);
        $("gm-lock").addEventListener("click", () => { const n = net(); if (n) { n.setLocked(!n.locked); renderNet(); } });
        $("gm-send").addEventListener("click", sendMsg);
        $("gm-msg").addEventListener("keydown", e => { if (e.key === "Enter") sendMsg(); });

        const n = net();
        if (n) {
            n.on("status", renderNet);
            n.on("players", renderRoster);
            n.on("join", e => log(`${e.player.name} (${who(e.player.id)}) joined`));
            n.on("leave", e => log(`${e.player.name} (${who(e.player.id)}) left: ${e.reason}`));
            n.on("latency", e => { if (e.id === 0) { lastRtt = e.ping; renderNet(); } });
            n.on("notice", t => log(t));
            n.on("error", e => log("ERROR: " + e.message, true));
            n.on("closed", e => {
                log(`DISCONNECTED: ${e.reason}`, true);
                live = false;
                renderAll();
            });
            n.on("message", m => {
                const d = m.data;
                if (d && d.kind === "level-hash") { // automatic check: did the client get the same level as the host?
                    if (game && game.mode === "host") {
                        const mine = levelHash(currentLevel());
                        log(`${who(m.from)} LEVEL HASH ${d.hash} ${d.hash === mine ? "= HOST (OK)" : "!= HOST " + mine + " (MISMATCH)"}`, d.hash !== mine);
                    }
                    return;
                }
                log(`[${who(m.from)}] ${dataText(d)}`);
            });
        }

        // leaving the game screen by any route (browser back, ...) drops the connection
        window.addEventListener("hashchange", () => {
            const n2 = net();
            if (!$("screen-gm").classList.contains("active") && live && n2 && n2.state !== "idle") n2.leave();
        });
    }

    // ---------- screen lifecycle ----------
    function init() { wire(); }

    function enter() {
        game = Store.get(GAME_PATH) || null;
        lastRtt = null;
        const n = net();

        if (!game) live = false;
        else if (game.mode === "solo") live = false;
        else live = !!n && n.state !== "idle" && n.role === (game.mode === "host" ? "host" : "client");

        $("gm-log").replaceChildren();
        $("gm-msg").value = "";
        renderAll();

        if (!game) log("no session - open this screen from the loader", true);
        else if (game.mode === "solo") log("solo session (no network)");
        else if (!live) log("the network session is not active (page reloaded?) - go back and start again", true);
        else if (game.mode === "host") log(`hosting - share code ${n.code}`);
        else {
            log(`connected to ${game.hostCode} as ${who(n.id)}`);
            n.send({ kind: "level-hash", hash: levelHash(currentLevel()) });
        }
    }

    registerScreen("screen-gm", { init, enter });
})();
