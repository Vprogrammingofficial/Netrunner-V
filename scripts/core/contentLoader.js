// contentLoader.js - registers, validates and serves content packs.
// Load AFTER storage.js and BEFORE any pack file. Packs call Content.register({...}).
//
// A pack is plain data (see packs/test_pack.js for the full format):
//   { id, name, version, core?: true, dependencies: [packIds],
//     decks: [], programs: [], hardware: [], effects: [], actions: [], icons: [] }
//   core: true packs can't be disabled. icons: [{ id, name, svg }] are looked up by id (level editor etc).
//
// Other systems only use:
//   Content.getActive()            -> { decks, programs, hardware, effects, actions, icons } (enabled packs only)
//   Content.get("programs", id)    -> one active item or undefined
//   Content.list()                 -> pack summaries for a UI
//   Content.setEnabled(id, bool)   Content.isEnabled(id)
//   Content.onChange(fn)           -> fires when enabled state changes

const Content = (() => {
    const COLLECTIONS = {
        decks: "deck",
        programs: "program",
        hardware: "hardware",
        effects: "effect",
        actions: "action",
        icons: "icon",
    };
    const PROGRAM_TYPES = ["booster", "defender", "attacker", "black_ice"];
    const MAX_DECK_SLOTS = 9;
    const ENABLED_PATH = "content.enabled"; // { [packId]: false } only explicit flags are stored

    const packs = new Map(); // packId -> normalized pack (registration order kept)
    const warnings = [];
    let activeCache = null;

    // ---- helpers ----
    function warn(msg) {
        warnings.push(msg);
        console.warn("[content] " + msg);
    }

    const isInt = (v, min) => Number.isInteger(v) && v >= min;
    const isId = v => typeof v === "string" && /^[a-z0-9_]+$/.test(v);

    function versionCmp(a, b) {
        const pa = String(a).split(".").map(n => parseInt(n) || 0);
        const pb = String(b).split(".").map(n => parseInt(n) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pa[i] || 0) - (pb[i] || 0);
            if (d) return d;
        }
        return 0;
    }

    // ---- per-collection validation: return an error string or null ----
    const VALIDATORS = {
        decks(it) {
            const s = it.slots;
            if (!s || !isInt(s.uv, 0) || !isInt(s.pr, 0) || !isInt(s.hw, 0)) return "slots must be { uv, pr, hw } integers >= 0";
            const total = s.uv + s.pr + s.hw;
            if (total < 1 || total > MAX_DECK_SLOTS) return `total slots must be 1-${MAX_DECK_SLOTS} (got ${total})`;
            return null;
        },
        programs(it) {
            if (!PROGRAM_TYPES.includes(it.type)) return `type must be one of ${PROGRAM_TYPES.join("/")}`;
            if (!isInt(it.sl, 1)) return "sl must be an integer >= 1";
            if (!isInt(it.hp, 1)) return "hp must be an integer >= 1";
            return null;
        },
        hardware(it) {
            if (!isInt(it.sl, 1)) return "sl must be an integer >= 1";
            return null;
        },
        effects() { return null; },
        actions(it) {
            const c = it.actcost;
            if (c !== undefined && c !== "all" && !(typeof c === "number" && c >= 0)) return 'actcost must be a number >= 0 or "all"';
            return null;
        },
        icons(it) {
            if (typeof it.svg !== "string") return "svg must be a string";
            return null;
        },
    };

    function normalizeItem(coll, raw, packId) {
        if (!raw || typeof raw !== "object") return { error: "not an object" };
        if (!isId(raw.id)) return { error: "id must be lowercase letters, digits and underscores" };
        if (typeof raw.name !== "string" || !raw.name) return { error: "name is required" };
        const item = {
            ...raw,
            kind: COLLECTIONS[coll],
            packId,
            desc: raw.desc ?? "",
            cost: raw.cost ?? 0,
        };
        const err = VALIDATORS[coll](item);
        if (err) return { error: err };
        return { item: Object.freeze(item) };
    }

    // ---- registration ----
    function register(pack) {
        if (!pack || !isId(pack.id)) { warn("pack rejected: missing/invalid id"); return false; }
        if (typeof pack.name !== "string" || !pack.name) { warn(`pack "${pack.id}" rejected: name is required`); return false; }
        if (typeof pack.version !== "string") { warn(`pack "${pack.id}" rejected: version string is required`); return false; }
        if (pack.dependencies !== undefined && !Array.isArray(pack.dependencies)) { warn(`pack "${pack.id}" rejected: dependencies must be an array`); return false; }

        const existing = packs.get(pack.id);
        if (existing && versionCmp(pack.version, existing.version) <= 0) {
            warn(`pack "${pack.id}" v${pack.version} ignored (v${existing.version} already registered)`);
            return false;
        }

        const norm = {
            id: pack.id,
            name: pack.name,
            version: pack.version,
            core: pack.core === true,
            dependencies: [...(pack.dependencies || [])],
            items: {},
        };

        for (const coll of Object.keys(COLLECTIONS)) {
            norm.items[coll] = [];
            const seen = new Set();
            for (const raw of (pack[coll] || [])) {
                const { item, error } = normalizeItem(coll, raw, pack.id);
                if (error) { warn(`${pack.id}.${coll}[${raw && raw.id}]: ${error} - skipped`); continue; }
                if (seen.has(item.id)) { warn(`${pack.id}.${coll}: duplicate id "${item.id}" - skipped`); continue; }
                seen.add(item.id);
                norm.items[coll].push(item);
            }
        }

        packs.set(norm.id, norm);
        activeCache = null;
        scheduleRender();
        return true;
    }

    // ---- enabled state ----
    function missingDeps(id) {
        const p = packs.get(id);
        return p ? p.dependencies.filter(d => !packs.has(d)) : [];
    }

    // a pack is enabled when its flag isn't false AND every dependency is enabled
    function isEnabled(id, _seen = new Set()) {
        const p = packs.get(id);
        if (!p || _seen.has(id)) return false;
        _seen.add(id);
        if (!p.core && Store.get(ENABLED_PATH + "." + id) === false) return false;
        return p.dependencies.every(d => isEnabled(d, new Set(_seen)));
    }

    // enabling a pack also enables its (transitive) dependencies
    function setEnabled(id, on) {
        if (!packs.has(id)) return { ok: false, reason: "Unknown pack" };
        if (!on && packs.get(id).core) return { ok: false, reason: "Core packs can't be disabled" };
        const flags = Store.get(ENABLED_PATH, {});
        if (on) {
            const stack = [id];
            const seen = new Set();
            while (stack.length) {
                const cur = stack.pop();
                if (seen.has(cur)) continue;
                seen.add(cur);
                const p = packs.get(cur);
                if (!p) return { ok: false, reason: `Missing dependency "${cur}"` };
                flags[cur] = true;
                stack.push(...p.dependencies);
            }
        } else {
            flags[id] = false; // dependents become disabled automatically via isEnabled
        }
        Store.set(ENABLED_PATH, flags);
        return { ok: true };
    }

    // ---- active content ----
    function buildActive() {
        const out = { decks: [], programs: [], hardware: [], effects: [], actions: [], icons: [], _byId: {} };
        for (const coll of Object.keys(COLLECTIONS)) out._byId[coll] = new Map();

        for (const p of packs.values()) {
            if (!isEnabled(p.id)) continue;
            for (const coll of Object.keys(COLLECTIONS)) {
                for (const item of p.items[coll]) {
                    if (out._byId[coll].has(item.id)) {
                        warn(`id clash in ${coll}: "${item.id}" from ${p.id} ignored (already provided by ${out._byId[coll].get(item.id).packId})`);
                        continue;
                    }
                    out._byId[coll].set(item.id, item);
                    out[coll].push(item);
                }
            }
        }
        return out;
    }

    function active() {
        if (!activeCache) activeCache = buildActive();
        return activeCache;
    }

    function getActive() {
        const a = active();
        return { decks: a.decks, programs: a.programs, hardware: a.hardware, effects: a.effects, actions: a.actions, icons: a.icons };
    }

    function get(collection, id) {
        const m = active()._byId[collection];
        return m ? m.get(id) : undefined;
    }

    function list() {
        return [...packs.values()].map(p => ({
            id: p.id,
            name: p.name,
            version: p.version,
            core: p.core,
            dependencies: [...p.dependencies],
            missing: missingDeps(p.id),
            enabled: isEnabled(p.id),
            counts: Object.fromEntries(Object.keys(COLLECTIONS).map(c => [c, p.items[c].length])),
        }));
    }

    function onChange(fn) {
        return Store.onChange(ENABLED_PATH, fn);
    }

    // ---- graphics: fills #content-list (inside #pu-content) using existing classes only ----
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function renderList() {
        const box = document.getElementById("content-list");
        if (!box) return;
        box.replaceChildren();
        const all = list();
        if (!all.length) { box.appendChild(el("div", "sl-charlist__empty", "NO PACKS REGISTERED")); return; }

        for (const pack of all) {
            const row = el("div", "sl-char-card");

            const info = el("div", "sl-char-card__info");
            info.appendChild(el("div", "sl-char-card__name", `${pack.name} v${pack.version}`));
            const counts = Object.entries(pack.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
            info.appendChild(el("div", "sl-char-card__stats", counts || "empty"));
            if (pack.dependencies.length) info.appendChild(el("div", "sl-char-card__date", "requires: " + pack.dependencies.join(", ")));
            if (pack.missing.length) info.appendChild(el("div", "sl-char-card__date", "MISSING: " + pack.missing.join(", ")));
            row.appendChild(info);

            const blocked = pack.missing.length > 0 || pack.core;
            const toggle = el("div", "peg-toggle" + (blocked ? " peg-toggle--disabled" : ""));
            toggle.appendChild(el("span", "peg-label peg-label--off", "OFF"));
            const track = el("div", "peg-track" + (pack.enabled ? " peg-track--on" : ""));
            track.appendChild(el("div", "peg-knob"));
            toggle.appendChild(track);
            toggle.appendChild(el("span", "peg-label peg-label--on", "ON"));
            if (!blocked) toggle.addEventListener("click", () => setEnabled(pack.id, !pack.enabled));
            row.appendChild(toggle);

            box.appendChild(row);
        }
    }

    // packs register after this file loads, so draw once the current script batch is done
    let renderTimer = null;
    function scheduleRender() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderList, 0);
    }

    // any change to enabled flags invalidates the cache, then redraws
    Store.onChange(ENABLED_PATH, () => { activeCache = null; scheduleRender(); });

    return { register, getActive, get, list, isEnabled, setEnabled, missingDeps, onChange, warnings, PROGRAM_TYPES };
})();
