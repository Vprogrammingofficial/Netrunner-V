// ne_state.js - netrunner maker logic. No DOM in here.
// The draft (what you're building) lives in Store at session.neDraft.
// Only ids are stored for installed items; slot sizes and rule results are
// recomputed from the active content every time (resolve()).

const NEState = (() => {
    const PATH = "session.neDraft";
    const VERSION = 1;
    const NAME_MAX = 24;

    const listeners = [];
    let draft = null;
    let view = null; // result of the last resolve()

    const fresh = () => ({
        v: VERSION,
        name: "Netrunner",
        interface: 4,
        hp: 40,
        chp: 40,
        team: 1,
        deck: null, // deck id
        installed: [], // [{ uid, id, kind: "program"|"hardware" }] in install order
        external: [], // [{ uid, id, kind: "hardware" }]
        nextUid: 1,
    });

    const collOf = kind => (kind === "program" ? "programs" : "hardware");

    // ---------- stats ----------
    function toInt(v, fallback, min, max = Infinity) {
        const n = parseInt(v);
        if (isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    function sanitizeStats(d) {
        d.name = String(d.name ?? "").trim().slice(0, NAME_MAX) || "Netrunner";
        d.interface = toInt(d.interface, 4, 0);
        d.hp = toInt(d.hp, 40, 10);
        d.chp = toInt(d.chp, d.hp, 1, d.hp);
        d.team = toInt(d.team, 1, 0);
    }

    // ---------- slot + rule resolution ----------
    function buildCells(deck) {
        const cells = [];
        if (!deck) return cells;
        for (let i = 0; i < deck.slots.pr; i++) cells.push({ kind: "p", uid: null });
        for (let i = 0; i < deck.slots.uv; i++) cells.push({ kind: "u", uid: null });
        for (let i = 0; i < deck.slots.hw; i++) cells.push({ kind: "h", uid: null });
        return cells;
    }

    // programs fill program-only cells then universal, left to right.
    // hardware fills hardware-only cells then universal, right to left.
    // so the two only compete for universal cells, and each item's cells are contiguous.
    function allocate(cells, kind, n) {
        const idx = cells.map((c, i) => i);
        const order = kind === "program" ?
            [...idx.filter(i => cells[i].kind === "p"), ...idx.filter(i => cells[i].kind === "u")] :
            [...idx.filter(i => cells[i].kind === "h").reverse(), ...idx.filter(i => cells[i].kind === "u").reverse()];
        const free = order.filter(i => !cells[i].uid);
        return free.length >= n ? free.slice(0, n) : null;
    }

    function collectHooks(deck, hwDefs, extDefs) {
        const hooks = [];
        if (deck && deck.maker && typeof deck.maker.onProgramAdd === "function") {
            hooks.push({ source: deck.name, fn: deck.maker.onProgramAdd });
        }
        for (const d of hwDefs) {
            if (d.maker && typeof d.maker.onProgramAdd === "function") hooks.push({ source: d.name, fn: d.maker.onProgramAdd });
        }
        for (const d of extDefs) {
            if (d.maker && typeof d.maker.onProgramAdd === "function") hooks.push({ source: d.name + " (external)", fn: d.maker.onProgramAdd });
        }
        return hooks;
    }

    // one validation pass over refs in install order
    function pass(refs, extDefs, deck) {
        const cells = buildCells(deck);
        const items = [];
        const dropped = [];

        const resolved = refs.map(r => ({ ref: r, kind: r.kind, def: Content.get(collOf(r.kind), r.id) }));
        const hwDefs = resolved.filter(x => x.def && x.kind === "hardware").map(x => x.def);
        const hooks = collectHooks(deck, hwDefs, extDefs);

        for (const x of resolved) {
            const drop = reason => dropped.push({ uid: x.ref.uid, kind: x.kind, name: x.def ? x.def.name : x.ref.id, reason });

            if (!x.def) { drop("Content no longer available"); continue; }
            if (!deck) { drop("No deck selected"); continue; }

            let sl = x.def.sl;
            if (x.kind === "program") {
                const ctx = {
                    program: x.def,
                    deck,
                    installed: items.map(i => ({ uid: i.uid, def: i.def, kind: i.kind, sl: i.sl })),
                    external: extDefs,
                };
                let rejected = null;
                for (const h of hooks) {
                    let res;
                    try { res = h.fn(ctx); } catch (e) {
                        console.warn(`Rule hook error in "${h.source}":`, e);
                        continue;
                    }
                    if (!res || res.ok === false) { rejected = (res && res.reason) || `Rejected by ${h.source}.`; break; }
                    if (typeof res.sl === "number") sl = Math.max(1, Math.min(sl, Math.floor(res.sl)));
                }
                if (rejected) { drop(rejected); continue; }
            }

            const slots = allocate(cells, x.kind, sl);
            if (!slots) { drop("Not enough slots"); continue; }
            slots.forEach(i => { cells[i].uid = x.ref.uid; });
            items.push({ uid: x.ref.uid, id: x.ref.id, kind: x.kind, def: x.def, sl, baseSl: x.def.sl, cells: slots });
        }
        return { cells, items, dropped };
    }

    // full validation of an installed list + external list against a deck.
    // Dropped hardware changes the rule hooks, so passes repeat until hardware is stable.
    function resolve(refs, extRefs, deck) {
        const extItems = [];
        const dropped = [];
        for (const r of extRefs) {
            const def = Content.get("hardware", r.id);
            if (def) extItems.push({ uid: r.uid, id: r.id, kind: "hardware", def });
            else dropped.push({ uid: r.uid, kind: "hardware", name: r.id, reason: "Content no longer available" });
        }
        const extDefs = extItems.map(x => x.def);

        const hwDropped = new Map();
        let result;
        for (let n = 0; n < 10; n++) {
            result = pass(refs.filter(r => !hwDropped.has(r.uid)), extDefs, deck);
            const newHw = result.dropped.filter(d => d.kind === "hardware" && !hwDropped.has(d.uid));
            if (!newHw.length) break;
            newHw.forEach(d => hwDropped.set(d.uid, d));
        }
        dropped.push(...hwDropped.values(), ...result.dropped);

        return {
            installed: result.items.map(i => ({ uid: i.uid, id: i.id, kind: i.kind })),
            external: extItems.map(i => ({ uid: i.uid, id: i.id, kind: "hardware" })),
            items: result.items,
            extItems,
            cells: result.cells,
            dropped,
        };
    }

    // ---------- draft plumbing ----------
    function currentDeck() {
        return draft.deck ? Content.get("decks", draft.deck) : null;
    }

    function apply(r) {
        draft.installed = r.installed;
        draft.external = r.external;
        view = r;
    }

    function revalidate() {
        const deck = currentDeck();
        if (draft.deck && !deck) draft.deck = null; // deck's pack is disabled
        const r = resolve(draft.installed, draft.external, deck);
        apply(r);
        return r.dropped;
    }

    function commit() {
        Store.set(PATH, draft);
        listeners.slice().forEach(fn => fn());
    }

    const isRef = r => r && typeof r.uid === "string" && typeof r.id === "string" && (r.kind === "program" || r.kind === "hardware");

    // ---------- public ----------
    // loads the saved draft and revalidates it. Returns the dropped list (does not save or notify).
    function load() {
        const saved = Store.get(PATH);
        draft = fresh();
        if (saved && saved.v === VERSION) {
            Object.assign(draft, saved);
            draft.installed = Array.isArray(saved.installed) ? saved.installed.filter(isRef) : [];
            draft.external = Array.isArray(saved.external) ? saved.external.filter(r => isRef(r) && r.kind === "hardware") : [];
            if (!(draft.nextUid >= 1)) draft.nextUid = 1;
        }
        sanitizeStats(draft);
        return revalidate();
    }

    function ensureLoaded() { if (!draft) load(); }

    function setStats(partial) {
        ensureLoaded();
        for (const k of ["name", "interface", "hp", "chp", "team"]) {
            if (k in partial) draft[k] = partial[k];
        }
        sanitizeStats(draft);
        commit();
    }

    function selectDeck(id) {
        ensureLoaded();
        if (!Content.get("decks", id)) return [];
        draft.deck = id;
        const dropped = revalidate();
        commit();
        return dropped;
    }

    // returns { ok, reason?, dropped? }
    function install(kind, id) {
        ensureLoaded();
        if (kind !== "program" && kind !== "hardware") return { ok: false, reason: "Only programs and hardware can be installed." };
        const def = Content.get(collOf(kind), id);
        if (!def) return { ok: false, reason: "Unknown item." };
        const deck = currentDeck();
        if (!deck) return { ok: false, reason: "Select a deck first." };

        const ref = { uid: String(draft.nextUid), id, kind };
        const r = resolve([...draft.installed, ref], draft.external, deck);
        const lost = r.dropped.find(d => d.uid === ref.uid);
        if (lost) return { ok: false, reason: lost.reason };

        draft.nextUid++;
        apply(r);
        commit();
        return { ok: true, dropped: r.dropped };
    }

    function installExternal(id) {
        ensureLoaded();
        const def = Content.get("hardware", id);
        if (!def) return { ok: false, reason: "Only hardware can be installed externally." };
        const ref = { uid: String(draft.nextUid++), id, kind: "hardware" };
        draft.external = [...draft.external, ref];
        const dropped = revalidate();
        commit();
        return { ok: true, dropped };
    }

    function remove(uid) {
        ensureLoaded();
        draft.installed = draft.installed.filter(r => r.uid !== uid);
        const dropped = revalidate();
        commit();
        return dropped;
    }

    function removeExternal(uid) {
        ensureLoaded();
        draft.external = draft.external.filter(r => r.uid !== uid);
        const dropped = revalidate();
        commit();
        return dropped;
    }

    function reset() {
        draft = fresh();
        revalidate();
        commit();
    }

    // call when content availability changed. Saves + notifies only if something was dropped.
    function refreshContent() {
        ensureLoaded();
        const dropped = revalidate();
        if (dropped.length) commit();
        else listeners.slice().forEach(fn => fn());
        return dropped;
    }

    function getView() {
        ensureLoaded();
        return {
            stats: { name: draft.name, interface: draft.interface, hp: draft.hp, chp: draft.chp, team: draft.team },
            deck: currentDeck(),
            cells: view.cells,
            items: view.items,
            extItems: view.extItems,
        };
    }

    // plain data for the save/load system later
    function exportData() {
        ensureLoaded();
        return {
            name: draft.name,
            hp: draft.hp,
            chp: draft.chp,
            interface: draft.interface,
            team: draft.team,
            deck: draft.deck,
            installed: draft.installed.map(r => r.id),
            external: draft.external.map(r => r.id),
        };
    }

    // replaces the draft with exported data (see exportData). Ids are re-resolved against active content:
    // unknown ids are skipped, the rest are revalidated in order. Returns the list of skipped/dropped items.
    function importData(data) {
        const d = data && typeof data === "object" ? data : {};
        draft = fresh();
        for (const k of ["name", "interface", "hp", "chp", "team"]) if (k in d) draft[k] = d[k];
        if (!("chp" in d)) draft.chp = draft.hp;
        sanitizeStats(draft);
        draft.deck = typeof d.deck === "string" ? d.deck : null;

        const skipped = [];
        const refFor = (id, hardwareOnly) => {
            const kind = !hardwareOnly && Content.get("programs", id) ? "program" : Content.get("hardware", id) ? "hardware" : null;
            if (!kind) { skipped.push({ uid: null, kind: "unknown", name: id, reason: "Content not available" }); return null; }
            return { uid: String(draft.nextUid++), id, kind };
        };
        const ids = a => (Array.isArray(a) ? a.filter(x => typeof x === "string") : []);
        draft.installed = ids(d.installed).map(id => refFor(id, false)).filter(Boolean);
        draft.external = ids(d.external).map(id => refFor(id, true)).filter(Boolean);

        const dropped = revalidate();
        commit();
        return [...skipped, ...dropped];
    }

    function subscribe(fn) {
        listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }

    return { load, setStats, selectDeck, install, installExternal, remove, removeExternal, reset, refreshContent, getView, exportData, importData, subscribe };
})();
