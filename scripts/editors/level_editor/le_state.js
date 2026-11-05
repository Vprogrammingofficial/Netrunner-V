// le_state.js - level editor logic. No DOM and no Content dependency in here.
// The draft lives in Store at session.leDraft. Tool / selection / "connecting" are UI-only and never saved.
//
// Level data (what exportData() returns and the game will eventually read):
//   { v, floors: [{ id, x, y, type: "entrance"|"standard", core, contents: [item] }],
//     connections: [{ id, from, to, dv }], nextId }
//   item: { uid, type: "file"|"control", name, dv }
//         { uid, type: "ice", id, name }          id = black ice content id, name = display snapshot
//         { uid, type: "netrunner", char: { name, hp, chp, interface, team, deck, installed[], external[] } }
//
// Floor 0 is always the entrance: it can't be deleted, dragged, or given a core.

const LEState = (() => {
    const PATH = "session.leDraft";
    const VERSION = 1;
    const FLOOR_R = 40;          // floor circle radius (world units)
    const NODE_R = 15;           // connection node radius (world units)
    const MIN_FLOOR_DIST = 100;  // floors get pushed apart below this
    const TOOLS = ["select", "floor", "connection", "delete"];
    const CHAR_NAME_MAX = 24;
    const ITEM_NAME_MAX = 40;

    const listeners = [];
    let draft = null;
    const ui = { tool: "select", selected: null, connecting: null }; // selected: { kind: "floor"|"connection", id }

    const entrance = () => ({ id: 0, x: 0, y: 0, type: "entrance", core: false, contents: [] });
    const fresh = () => ({ v: VERSION, floors: [entrance()], connections: [], nextId: 1 });

    // ---------- sanitizing ----------
    function toInt(v, fallback, min, max = Infinity) {
        const n = parseInt(v);
        if (isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    // accepts the netrunner maker's exportData() shape (or a saved character entry)
    function sanitizeChar(c) {
        c = c && typeof c === "object" ? c : {};
        const hp = toInt(c.hp, 40, 10);
        const ids = a => (Array.isArray(a) ? a.filter(x => typeof x === "string") : []);
        return {
            name: String(c.name ?? "").trim().slice(0, CHAR_NAME_MAX) || "Netrunner",
            hp,
            chp: toInt(c.chp, hp, 1, hp),
            interface: toInt(c.interface ?? c.if, 4, 0),
            team: toInt(c.team, 0, 0, 20),
            deck: typeof c.deck === "string" ? c.deck : null,
            installed: ids(c.installed ?? c.dc),
            external: ids(c.external ?? c.eh),
        };
    }

    // returns a clean item (uid may be null, assigned by the caller) or null if unusable
    function cleanItem(raw) {
        if (!raw || typeof raw !== "object") return null;
        const uid = typeof raw.uid === "string" && raw.uid ? raw.uid : null;
        switch (raw.type) {
            case "file":
            case "control": {
                const name = String(raw.name ?? "").trim().slice(0, ITEM_NAME_MAX);
                if (!name) return null;
                return { uid, type: raw.type, name, dv: toInt(raw.dv, 0, 0) };
            }
            case "ice":
                if (typeof raw.id !== "string" || !raw.id) return null;
                return { uid, type: "ice", id: raw.id, name: String(raw.name ?? raw.id).slice(0, ITEM_NAME_MAX) };
            case "netrunner":
                return { uid, type: "netrunner", char: sanitizeChar(raw.char) };
            default:
                return null;
        }
    }

    // rebuilds a whole level from untrusted data (saved draft, import, ...)
    function sanitize(raw) {
        const r = raw && typeof raw === "object" ? raw : {};
        const out = { v: VERSION, floors: [], connections: [], nextId: 1 };
        let next = 1;
        const bump = n => { if (Number.isInteger(n) && n >= next) next = n + 1; };

        const floorIds = new Set();
        const usedUids = new Set();

        for (const f of Array.isArray(r.floors) ? r.floors : []) {
            if (!f || !Number.isInteger(f.id) || f.id < 0 || floorIds.has(f.id)) continue;
            if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
            floorIds.add(f.id);
            bump(f.id);
            const floor = {
                id: f.id,
                x: f.x,
                y: f.y,
                type: f.id === 0 ? "entrance" : "standard",
                core: f.id !== 0 && !!f.core,
                contents: [],
            };
            for (const rawItem of Array.isArray(f.contents) ? f.contents : []) {
                const item = cleanItem(rawItem);
                if (!item) continue;
                if (item.uid && !usedUids.has(item.uid)) {
                    usedUids.add(item.uid);
                    if (/^\d+$/.test(item.uid)) bump(parseInt(item.uid));
                } else {
                    item.uid = null;
                }
                floor.contents.push(item);
            }
            out.floors.push(floor);
        }
        if (!floorIds.has(0)) { out.floors.unshift(entrance()); floorIds.add(0); }

        const pairs = new Set();
        for (const c of Array.isArray(r.connections) ? r.connections : []) {
            if (!c || !Number.isInteger(c.id) || c.id < 0) continue;
            if (!floorIds.has(c.from) || !floorIds.has(c.to) || c.from === c.to) continue;
            const key = Math.min(c.from, c.to) + "-" + Math.max(c.from, c.to);
            if (pairs.has(key)) continue;
            pairs.add(key);
            bump(c.id);
            out.connections.push({ id: c.id, from: c.from, to: c.to, dv: toInt(c.dv, 0, 0) });
        }

        for (const f of out.floors) for (const item of f.contents) if (!item.uid) item.uid = String(next++);
        out.nextId = Math.max(next, toInt(r.nextId, 1, 1));
        return out;
    }

    // ---------- plumbing ----------
    function ensureLoaded() { if (!draft) load(); }
    function emit() { listeners.slice().forEach(fn => fn()); }
    function commit() { Store.set(PATH, draft); emit(); }

    const floorById = id => draft.floors.find(f => f.id === id);
    const connById = id => draft.connections.find(c => c.id === id);

    function resolveCollisions(floor) {
        let moved = true, n = 0;
        while (moved && n < 10) {
            moved = false; n++;
            for (const o of draft.floors) {
                if (o.id === floor.id) continue;
                const dx = floor.x - o.x, dy = floor.y - o.y;
                const d = Math.hypot(dx, dy);
                if (d >= MIN_FLOOR_DIST) continue;
                if (d === 0) { floor.x = o.x + MIN_FLOOR_DIST; moved = true; continue; }
                const a = Math.atan2(dy, dx);
                floor.x = o.x + Math.cos(a) * MIN_FLOOR_DIST;
                floor.y = o.y + Math.sin(a) * MIN_FLOOR_DIST;
                moved = true;
            }
        }
    }

    // ---------- public: lifecycle ----------
    // loads the saved draft. UI state (selection) resets, the chosen tool is kept.
    function load() {
        const saved = Store.get(PATH);
        draft = saved && saved.v === VERSION ? sanitize(saved) : fresh();
        ui.selected = null;
        ui.connecting = null;
        return draft;
    }

    function reset() {
        ensureLoaded();
        draft = fresh();
        ui.selected = null;
        ui.connecting = null;
        commit();
    }

    function subscribe(fn) {
        listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }

    // read-only snapshot of references (don't mutate what comes back)
    function getView() {
        ensureLoaded();
        return {
            floors: draft.floors,
            connections: draft.connections,
            tool: ui.tool,
            selected: ui.selected,
            connecting: ui.connecting,
        };
    }

    // plain data for the save/load system
    function exportData() {
        ensureLoaded();
        return JSON.parse(JSON.stringify(draft));
    }

    // replaces the draft with (sanitized) level data
    function loadData(data) {
        ensureLoaded();
        draft = sanitize(data);
        ui.selected = null;
        ui.connecting = null;
        commit();
    }

    // ---------- public: UI state (not saved) ----------
    function setTool(tool) {
        if (!TOOLS.includes(tool)) return;
        ui.tool = tool;
        ui.selected = null;
        ui.connecting = null;
        emit();
    }

    function select(sel) {
        ui.selected = sel ? { kind: sel.kind, id: sel.id } : null;
        emit();
    }

    function setConnecting(id) {
        ui.connecting = id === null || id === undefined ? null : id;
        emit();
    }

    // ---------- public: hit testing (world coordinates) ----------
    function connectionMid(c) {
        ensureLoaded();
        const a = floorById(c.from), b = floorById(c.to);
        return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    }

    function floorAt(x, y) {
        ensureLoaded();
        for (let i = draft.floors.length - 1; i >= 0; i--) { // last drawn = on top
            const f = draft.floors[i];
            const dx = f.x - x, dy = f.y - y;
            if (dx * dx + dy * dy < FLOOR_R * FLOOR_R) return f;
        }
        return undefined;
    }

    function connectionAt(x, y) {
        ensureLoaded();
        return draft.connections.find(c => {
            const m = connectionMid(c);
            if (!m) return false;
            const dx = m.x - x, dy = m.y - y;
            return dx * dx + dy * dy < NODE_R * NODE_R;
        });
    }

    // ---------- public: editing ----------
    function addFloor(x, y) {
        ensureLoaded();
        const f = { id: draft.nextId++, x, y, type: "standard", core: false, contents: [] };
        draft.floors.push(f);
        resolveCollisions(f);
        commit();
        return f;
    }

    // live drag: mutates without saving. Call endMove() when the drag finishes.
    function moveFloor(id, x, y) {
        ensureLoaded();
        const f = floorById(id);
        if (!f || f.id === 0) return;
        f.x = x;
        f.y = y;
        resolveCollisions(f);
    }

    function endMove() {
        ensureLoaded();
        commit();
    }

    function deleteFloor(id) {
        ensureLoaded();
        if (id === 0 || !floorById(id)) return false;
        const goneConns = new Set(draft.connections.filter(c => c.from === id || c.to === id).map(c => c.id));
        draft.floors = draft.floors.filter(f => f.id !== id);
        draft.connections = draft.connections.filter(c => !goneConns.has(c.id));
        const s = ui.selected;
        if (s && ((s.kind === "floor" && s.id === id) || (s.kind === "connection" && goneConns.has(s.id)))) ui.selected = null;
        if (ui.connecting === id) ui.connecting = null;
        commit();
        return true;
    }

    function addConnection(fromId, toId) {
        ensureLoaded();
        if (fromId === toId || !floorById(fromId) || !floorById(toId)) return null;
        const exists = draft.connections.some(c => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId));
        if (exists) return null;
        const c = { id: draft.nextId++, from: fromId, to: toId, dv: 0 };
        draft.connections.push(c);
        commit();
        return c;
    }

    function deleteConnection(id) {
        ensureLoaded();
        if (!connById(id)) return false;
        draft.connections = draft.connections.filter(c => c.id !== id);
        if (ui.selected && ui.selected.kind === "connection" && ui.selected.id === id) ui.selected = null;
        commit();
        return true;
    }

    function setConnectionDv(id, value) {
        ensureLoaded();
        const c = connById(id);
        if (!c) return;
        c.dv = toInt(value, 0, 0);
        commit();
    }

    function toggleCore(floorId) {
        ensureLoaded();
        const f = floorById(floorId);
        if (!f || f.id === 0) return;
        f.core = !f.core;
        commit();
    }

    // raw: { type, ...fields } - cleaned here. Returns the stored item or null.
    function addContent(floorId, raw) {
        ensureLoaded();
        const f = floorById(floorId);
        const item = cleanItem({ ...raw, uid: null });
        if (!f || !item) return null;
        item.uid = String(draft.nextId++);
        f.contents.push(item);
        commit();
        return item;
    }

    function removeContent(floorId, uid) {
        ensureLoaded();
        const f = floorById(floorId);
        if (!f) return;
        f.contents = f.contents.filter(i => i.uid !== uid);
        commit();
    }

    return {
        FLOOR_R, NODE_R, TOOLS,
        load, reset, subscribe, getView, exportData, loadData,
        setTool, select, setConnecting,
        floorAt, connectionAt, connectionMid,
        addFloor, moveFloor, endMove, deleteFloor,
        addConnection, deleteConnection, setConnectionDv,
        toggleCore, addContent, removeContent,
        cleanChar: sanitizeChar,
        sanitizeLevel: sanitize,
        defaultChar: () => sanitizeChar({}),
    };
})();
