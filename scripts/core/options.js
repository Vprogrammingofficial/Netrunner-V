// options.js - user options. Each value lives in Store at options.<key> and drives a data attribute on
// <html> (e.g. textFlicker -> data-text-flicker="on"|"off"), which core.css reacts to.
//
// Add an option: add a row to DEFS, then style/read its data attribute (or Options.get) wherever it applies.
// Load AFTER storage.js. The toggle rows are built into the container named by each def's `section`.

const Options = (() => {
    const DEFS = [
        { key: "textFlicker", label: "TEXT FLICKER", section: "opt-visual", default: true },
        { key: "outlineFlicker", label: "OUTLINE FLICKER", section: "opt-visual", default: true },
        { key: "scanlines", label: "SCANLINES", section: "opt-visual", default: true },
    ];

    const byKey = Object.fromEntries(DEFS.map(d => [d.key, d]));
    const tracks = {}; // key -> toggle track element
    const path = key => "options." + key;

    // ---------- values ----------
    function get(key) {
        const def = byKey[key];
        if (!def) return undefined;
        const v = Store.get(path(key));
        return typeof v === "boolean" ? v : def.default; // anything odd in storage falls back to the default
    }

    function set(key, value) {
        if (!byKey[key]) return false;
        return Store.set(path(key), !!value);
    }

    function toggle(key) {
        return set(key, !get(key));
    }

    // ---------- apply ----------
    function apply() {
        for (const d of DEFS) document.documentElement.dataset[d.key] = get(d.key) ? "on" : "off";
    }

    // ---------- UI ----------
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function buildUI() {
        for (const d of DEFS) {
            const host = document.getElementById(d.section);
            if (!host) { console.warn(`[options] missing container #${d.section} for "${d.key}"`); continue; }

            const row = el("div", "opt-row");
            row.appendChild(el("div", "opt-label", d.label));

            const tgl = el("div", "peg-toggle");
            const track = el("div", "peg-track");
            track.appendChild(el("div", "peg-knob"));
            tgl.append(el("span", "peg-label peg-label--off", "OFF"), track, el("span", "peg-label peg-label--on", "ON"));
            tgl.addEventListener("click", () => toggle(d.key));

            row.appendChild(tgl);
            host.appendChild(row);
            tracks[d.key] = track;
        }
    }

    function syncUI() {
        for (const [key, track] of Object.entries(tracks)) track.classList.toggle("peg-track--on", get(key));
    }

    // fires after any option changes (including Store.reset / importAll)
    function onChange(fn) {
        return Store.onChange("options", fn);
    }

    // ---------- init ----------
    apply();
    buildUI();
    syncUI();
    onChange(() => { apply(); syncUI(); });

    return { get, set, toggle, onChange, DEFS };
})();
