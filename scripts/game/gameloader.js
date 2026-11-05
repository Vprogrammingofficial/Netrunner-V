// gameloader.js - the game loader screen (screen-gl): main page, play / host popups, and the level + character wings.
// Needs: storage, screenmaster, saveload (encode/decode), contentLoader, le_state (sanitizers).
//
// Selection (what the player has loaded) lives in Store at session.glSel:
//   { level: { name, data } | null, char: { name, hp, chp, interface, team, deck, installed[], external[] } | null }
// Current HP edits change this selection only, never the saved character.
//
// Hand-off to the game / network layer:
//   JACK IN (solo)    -> Store session.game = { mode: "solo", level, char }, then shows #screen-gm (gametest.js)
//   JACK IN (connect) -> GLNet.connect({ hostCode, char })  resolves { level, id, players }, then session.game is saved
//   START NETWORK     -> GLNet.host({ level })              resolves the host code; the host popup then shows a live lobby
//                        then session.game = { mode: "host", level } and #screen-gm opens. See net.js.
// If GLNet isn't loaded the loader says so.

const GameLoader = (() => {
    const SEL_PATH = "session.glSel";
    const GAME_PATH = "session.game";
    const POPUPS = ["pu-gl-play", "pu-gl-jack", "pu-gl-host", "pu-gl-tutorial"];
    const NAME_MAX = 40;

    const $ = id => document.getElementById(id);

    const sel = { level: null, char: null };
    const wings = [];
    let mode = "solo"; // jack popup: "solo" | "connect"

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function say(id, msg, bad) {
        const f = $(id);
        if (!f) return;
        f.textContent = msg;
        f.style.color = bad ? "#ff4444" : "";
    }
    const jackFb = (m, bad) => say("gl-jack-feedback", m, bad);
    const hostFb = (m, bad) => say("gl-host-feedback", m, bad);
    const errText = e => String((e && e.message) || e).toUpperCase();

    // ---------- selection ----------
    function saveSel() { Store.set(SEL_PATH, sel); }

    function loadSel() {
        const s = Store.get(SEL_PATH);
        if (s && s.level && s.level.data && Array.isArray(s.level.data.floors)) {
            sel.level = { name: String(s.level.name || "").slice(0, NAME_MAX), data: LEState.sanitizeLevel(s.level.data) };
        }
        if (s && s.char && typeof s.char === "object") sel.char = LEState.cleanChar(s.char);
    }

    function setLevel(name, data) {
        if (!data || typeof data !== "object" || !Array.isArray(data.floors)) return { ok: false, error: "NOT A LEVEL" };
        sel.level = { name: String(name || "").trim().slice(0, NAME_MAX) || "Untitled Level", data: LEState.sanitizeLevel(data) };
        saveSel();
        refresh("level");
        return { ok: true };
    }

    function setChar(data) {
        if (!data || typeof data !== "object" || !Array.isArray(data.installed)) return { ok: false, error: "NOT A CHARACTER" };
        sel.char = LEState.cleanChar(data);
        saveSel();
        refresh("char");
        return { ok: true };
    }

    function setChp(v) {
        if (!sel.char) return;
        const n = parseInt(v);
        if (isNaN(n)) return;
        sel.char.chp = Math.max(1, Math.min(sel.char.hp, n));
        saveSel();
        refresh("hp");
    }

    // ---------- wings (load level / load character) ----------
    const WING = {
        level: { title: "LOAD LEVEL", listLabel: "SAVED LEVELS", domain: "levels", placeholder: "Paste level code" },
        char: { title: "LOAD CHARACTER", listLabel: "SAVED NETRUNNERS", domain: "characters", placeholder: "Paste character code" },
    };

    function apply(kind, data, name) {
        return kind === "level" ? setLevel(name, data) : setChar(data);
    }

    // saved entries: levels are { name, saved, data }, characters are stored flat (see saveload.js)
    function entryPayload(kind, e) {
        if (kind === "level") return { name: e.name, data: e.data };
        const { uid, saved, ...d } = e;
        return { name: e.name, data: d };
    }

    function buildWing(kind) {
        const cfg = WING[kind];
        const root = el("div", "sh-frame gl-wing");

        const ta = el("textarea", "sl-textarea");
        ta.placeholder = cfg.placeholder;
        ta.spellcheck = false;

        const fb = el("div", "sl-feedback");
        const feedback = (m, bad) => { fb.textContent = m; fb.style.color = bad ? "#ff4444" : ""; };

        const load = el("div", "sh-button", "LOAD");
        load.addEventListener("click", () => {
            const text = ta.value.trim();
            if (!text) { feedback("ENTER A CODE", true); return; }
            let env;
            try { env = SaveLoad.decode(text); } catch { feedback("INVALID CODE", true); return; }
            if (env.k !== kind) { feedback(`WRONG CODE TYPE (EXPECTED ${kind.toUpperCase()})`, true); return; }
            const r = apply(kind, env.d, env.n);
            if (r.ok) feedback("LOADED"); else feedback(r.error, true);
        });

        const list = el("div", "sl-charlist");

        function renderList() {
            list.replaceChildren();
            const entries = Store.list(cfg.domain);
            if (!entries.length) { list.appendChild(el("div", "sl-charlist__empty", "NO SAVES")); return; }
            for (const entry of entries) {
                const card = el("div", "sl-char-card");
                const info = el("div", "sl-char-card__info");
                info.appendChild(el("div", "sl-char-card__name", entry.name || "UNNAMED"));
                info.appendChild(el("div", "sl-char-card__date", SaveLoad.fmtDate(entry.saved)));
                card.appendChild(info);

                const actions = el("div", "sl-char-card__actions");
                const b = el("div", "sl-char-btn", "LOAD");
                b.addEventListener("click", () => {
                    const p = entryPayload(kind, entry);
                    const r = apply(kind, p.data, p.name);
                    if (r.ok) feedback("LOADED"); else feedback(r.error, true);
                });
                actions.appendChild(b);
                card.appendChild(actions);
                list.appendChild(card);
            }
        }

        root.append(
            el("div", "opt-header", cfg.title),
            ta, fb, load,
            el("div", "sl-charlist-label", cfg.listLabel),
            list
        );
        wings.push({ renderList });
        return root;
    }

    // ---------- mini character ----------
    let hpRefs = null;

    function renderChar() {
        const box = $("gl-char");
        box.replaceChildren();
        hpRefs = null;

        const c = sel.char;
        if (!c) { box.appendChild(el("div", "le-empty", "NO CHARACTER LOADED")); return; }

        const card = el("div", "gl-char");
        card.appendChild(el("div", "sl-char-card__name", c.name));

        const deck = c.deck ? Content.get("decks", c.deck) : null;
        const deckText = deck ? deck.name : c.deck ? `${c.deck} (MISSING)` : "NONE";
        card.appendChild(el("div", "sl-char-card__stats", `DECK: ${deckText}`));
        card.appendChild(el("div", "sl-char-card__stats", `INT ${c.interface} | TEAM ${c.team} | ${c.installed.length} INSTALLED | ${c.external.length} EXTERNAL`));

        const row = el("div", "gl-hp");
        const minus = el("div", "sl-char-btn", "-");
        const plus = el("div", "sl-char-btn", "+");
        const input = el("input", "le-property-input");
        input.type = "number";
        input.min = 1;
        input.max = c.hp;
        input.value = c.chp;
        minus.addEventListener("click", () => setChp(sel.char.chp - 1));
        plus.addEventListener("click", () => setChp(sel.char.chp + 1));
        input.addEventListener("input", () => setChp(input.value));
        input.addEventListener("change", () => { input.value = sel.char.chp; }); // show the clamped value
        row.append(el("span", null, "HP"), minus, input, plus, el("span", null, `/ ${c.hp}`));
        card.appendChild(row);

        const bar = el("div", "gl-hpbar");
        const fill = el("div", "gl-hpbar__fill");
        bar.appendChild(fill);
        card.appendChild(bar);

        hpRefs = { input, fill };
        box.appendChild(card);
        updateHp();
    }

    function updateHp() {
        const c = sel.char;
        if (!hpRefs || !c) return;
        if (document.activeElement !== hpRefs.input) hpRefs.input.value = c.chp; // don't fight typing
        hpRefs.fill.style.width = (c.chp / c.hp * 100) + "%";
    }

    // ---------- level preview ----------
    function drawPreview(canvas, level) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);

        if (!level) {
            ctx.fillStyle = "rgba(0,255,65,0.35)";
            ctx.font = "14px 'Courier New'";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("NO LEVEL LOADED", w / 2, h / 2);
            return;
        }

        const R = LEState.FLOOR_R, pad = 16;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const f of level.floors) {
            minX = Math.min(minX, f.x - R); maxX = Math.max(maxX, f.x + R);
            minY = Math.min(minY, f.y - R); maxY = Math.max(maxY, f.y + R);
        }
        const s = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY), 1);
        const ox = (w - (maxX - minX) * s) / 2 - minX * s;
        const oy = (h - (maxY - minY) * s) / 2 - minY * s;
        const pt = f => ({ x: f.x * s + ox, y: f.y * s + oy });
        const byId = new Map(level.floors.map(f => [f.id, f]));

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#00ff41";
        for (const c of level.connections) {
            const a = byId.get(c.from), b = byId.get(c.to);
            if (!a || !b) continue;
            const p1 = pt(a), p2 = pt(b);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            if (c.dv > 0) { // locked connection
                ctx.fillStyle = "#ff0066";
                ctx.beginPath();
                ctx.arc((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        for (const f of level.floors) {
            const p = pt(f);
            const r = Math.max(4, R * s);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = "#1a1a1a";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = f.type === "entrance" ? "#ff0066" : "#00ff41";
            ctx.stroke();
            if (f.core) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
                ctx.fillStyle = "#ccaa00";
                ctx.fill();
            }
        }
    }

    function updatePreview() {
        const canvas = $("gl-preview");
        if (!canvas) return;
        const lvl = sel.level;
        drawPreview(canvas, lvl && lvl.data);

        const info = $("gl-preview-info");
        info.replaceChildren();
        if (!lvl) return;
        const d = lvl.data;
        const items = d.floors.reduce((n, f) => n + f.contents.length, 0);
        const cores = d.floors.filter(f => f.core).length;
        info.appendChild(el("div", "sl-char-card__name", lvl.name));
        info.appendChild(el("div", "sl-char-card__stats", `${d.floors.length} FLOORS | ${d.connections.length} CONNECTIONS | ${cores} CORE | ${items} ITEMS`));
    }

    // ---------- lights + buttons ----------
    const ready = () => (mode === "solo" ? !!(sel.level && sel.char) : !!sel.char);

    function updateLights() {
        $("gl-light-level").classList.toggle("gl-light--on", !!sel.level);
        $("gl-light-char").classList.toggle("gl-light--on", !!sel.char);
        $("gl-jackin").classList.toggle("gl-disabled", !ready());
        $("gl-start-net").classList.toggle("gl-disabled", !sel.level);
    }

    function refresh(what) {
        if (what === "hp") { updateHp(); return; }
        if (what === "all" || what === "char") renderChar();
        updateLights();
        updatePreview();
    }

    // ---------- popups ----------
    function hideAll() { for (const id of POPUPS) { const p = $(id); if (p) p.style.display = "none"; } }

    function showOnly(id) {
        hideAll();
        $(id).style.display = "flex";
        wings.forEach(w => w.renderList()); // saves may have changed in the editors
    }

    function openJack(m) {
        mode = m;
        const connect = m === "connect";
        $("gl-jack-title").textContent = connect ? "CONNECT" : "SOLO";
        $("gl-slot-level").classList.toggle("gl-hidden", connect);
        $("gl-lb-level").classList.toggle("gl-hidden", connect);
        $("gl-host-row").style.display = connect ? "" : "none";
        jackFb("");
        refresh("all");
        showOnly("pu-gl-jack");
    }

    function openHost() {
        hostFb("");
        renderLobby();
        refresh("all");
        showOnly("pu-gl-host");
    }

    // ---------- actions ----------
    function launch(payload) {
        Store.set(GAME_PATH, payload);
        if ($("screen-gm")) { hideAll(); showScreen("screen-gm"); }
        else jackFb("GAME SCREEN NOT BUILT YET (SELECTION SAVED)");
    }

    function jackIn() {
        if (!ready()) { jackFb(mode === "solo" ? "LOAD A LEVEL AND A CHARACTER" : "LOAD A CHARACTER", true); return; }

        if (mode === "solo") { launch({ mode: "solo", level: sel.level, char: sel.char }); return; }

        const hostCode = $("gl-host-code").value.trim();
        if (!hostCode) { jackFb("ENTER A HOST CODE", true); return; }
        const net = window.GLNet;
        if (!net || typeof net.connect !== "function") { jackFb("NETWORK MODULE NOT LOADED", true); return; }
        if (net.state !== "idle") { jackFb("NETWORK BUSY", true); return; }

        jackFb("CONNECTING...");
        Promise.resolve(net.connect({ hostCode, char: sel.char })).then(
            r => launch({ mode: "connect", hostCode, char: sel.char, level: r && r.level }),
            e => jackFb(errText(e), true)
        );
    }

    function startNetwork() {
        const net = window.GLNet;
        if (!net || typeof net.host !== "function") { hostFb("NETWORK MODULE NOT LOADED", true); return; }

        if (net.role === "host") { // the button is STOP NETWORK while hosting
            hostFb("STOPPING...");
            net.leave().then(() => hostFb("NETWORK STOPPED"));
            return;
        }
        if (net.state !== "idle") { hostFb("NETWORK BUSY", true); return; }
        if (!sel.level) { hostFb("LOAD A LEVEL FIRST", true); return; }

        hostFb("STARTING...");
        net.host({ level: sel.level }).then(
            code => { hostFb(`HOSTING - CODE: ${code}`); launch({ mode: "host", level: sel.level }); },
            e => hostFb(errText(e), true)
        );
    }

    // live lobby under the host preview: code + connected players
    function renderLobby() {
        const box = $("gl-lobby");
        const btn = $("gl-start-net");
        if (!box || !btn) return;
        box.replaceChildren();

        const net = window.GLNet;
        const hosting = !!net && net.role === "host" && net.state === "hosting";
        btn.textContent = hosting ? "STOP NETWORK" : net && net.state === "opening" ? "STARTING..." : "START NETWORK";
        if (!hosting) return;

        box.appendChild(el("div", "sl-charlist-label", `LOBBY - CODE ${net.code}`));
        for (const p of net.players()) {
            const card = el("div", "sl-char-card");
            const info = el("div", "sl-char-card__info");
            info.appendChild(el("div", "sl-char-card__name", p.name));
            info.appendChild(el("div", "sl-char-card__stats", p.host ? "HOST" : `TEAM ${p.team} | ${p.ping == null ? "--" : p.ping + " MS"}`));
            card.appendChild(info);
            if (!p.host) {
                const kick = el("div", "sl-char-btn sl-char-btn--delete", "KICK");
                kick.addEventListener("click", () => net.kick(p.id));
                card.appendChild(kick);
            }
            box.appendChild(card);
        }
    }

    // ---------- screen lifecycle ----------
    function init() {
        loadSel();
        document.querySelectorAll("[data-gl-wing]").forEach(slot => slot.appendChild(buildWing(slot.dataset.glWing)));

        const on = (id, fn) => $(id).addEventListener("click", fn);
        on("gl-play", () => showOnly("pu-gl-play"));
        on("gl-host", openHost);
        on("gl-tutorial", () => showOnly("pu-gl-tutorial"));

        on("gl-play-connect", () => openJack("connect"));
        on("gl-play-solo", () => openJack("solo"));
        on("gl-play-close", hideAll);
        on("gl-tutorial-close", hideAll);

        on("gl-jackin", jackIn);
        on("gl-jack-close", () => showOnly("pu-gl-play"));
        on("gl-start-net", startNetwork);
        on("gl-host-close", hideAll);

        window.addEventListener("hashchange", hideAll); // back/forward shouldn't leave popups hanging

        const net = window.GLNet;
        if (net) {
            net.on("players", renderLobby);
            net.on("status", renderLobby);
            net.on("join", e => hostFb(`${e.player.name} JOINED`));
            net.on("leave", e => hostFb(`${e.player.name} LEFT (${e.reason})`));
            net.on("error", e => { hostFb(errText(e), true); jackFb(errText(e), true); });
            net.on("closed", e => { renderLobby(); hostFb(`NETWORK CLOSED: ${e.reason}`); jackFb(`DISCONNECTED: ${e.reason}`, true); });
        }
        refresh("all");
    }

    function enter() {
        hideAll();
        refresh("all");
    }

    registerScreen("screen-gl", { init, enter });

    return { selection: () => JSON.parse(JSON.stringify(sel)), drawPreview };
})();
