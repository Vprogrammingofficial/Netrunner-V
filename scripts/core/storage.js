const Store = (() => {
    const PREFIX = "nr:";
    const VERSION = 1;
    const DOMAINS = ["options", "ui", "characters", "levels", "content", "session"];
    const DEFAULTS = {
        options: {},
        ui: {},
        characters: {}, // { [uid]: characterData }
        levels: {}, // { [uid]: levelData }
        content: {}, // enabled packs etc.
        session: {}, // screen, popups, drafts, editor camera...
    };
    const DEBOUNCE_MS = 250;

    const cache = {};
    const dirty = new Set();
    const timers = {};
    const listeners = []; // { path, fn }
    const errorListeners = [];

    // ---- helpers ----
    const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const split = path => String(path).split(".").filter(Boolean);

    function emitError(err, domain) {
        console.warn("Store error [" + domain + "]:", err);
        errorListeners.forEach(fn => { try { fn(err, domain); } catch {} });
    }

    function readDomain(d) {
        try {
            const raw = localStorage.getItem(PREFIX + d);
            return raw ? JSON.parse(raw) : clone(DEFAULTS[d]);
        } catch (e) {
            emitError(e, d);
            return clone(DEFAULTS[d]);
        }
    }

    function writeDomain(d) {
        clearTimeout(timers[d]);
        delete timers[d];
        dirty.delete(d);
        try {
            localStorage.setItem(PREFIX + d, JSON.stringify(cache[d]));
            return true;
        } catch (e) { // quota exceeded, private mode, etc.
            emitError(e, d);
            return false;
        }
    }

    function schedule(d) {
        dirty.add(d);
        clearTimeout(timers[d]);
        timers[d] = setTimeout(() => writeDomain(d), DEBOUNCE_MS);
    }

    function notify(path) {
        // fire listeners whose path is the changed path, a parent of it, or a child of it
        for (const l of listeners.slice()) {
            if (path === l.path || path.startsWith(l.path + ".") || l.path.startsWith(path + ".")) {
                try { l.fn(Store.get(l.path), path); } catch (e) { console.error(e); }
            }
        }
    }

    // ---- init ----
    function init() {
        // wrong/missing version -> start clean (old saves are not supported)
        let ver = null;
        try { ver = parseInt(localStorage.getItem(PREFIX + "version")); } catch {}
        if (ver !== VERSION) {
            wipeAll(true);
            try { localStorage.setItem(PREFIX + "version", String(VERSION)); } catch {}
        }
        for (const d of DOMAINS) cache[d] = readDomain(d);
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flush();
        });
    }

    function wipeAll(includeLegacy) {
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIX) && k !== PREFIX + "version") kill.push(k);
        }
        if (includeLegacy) kill.push("netrunner_store", "netrunner_options", "charList", "levelList");
        kill.forEach(k => localStorage.removeItem(k));
    }

    // ---- public api ----
    function get(path, fallback) {
        const [d, ...rest] = split(path);
        if (!cache[d]) return fallback;
        let node = cache[d];
        for (const k of rest) {
            if (node == null || typeof node !== "object") return fallback;
            node = node[k];
        }
        return node === undefined ? fallback : clone(node);
    }

    function set(path, value) {
        const [d, ...rest] = split(path);
        if (!cache[d]) { console.warn("Store.set: unknown domain", d); return false; }
        if (!rest.length) {
            cache[d] = clone(value);
        } else {
            let node = cache[d];
            for (let i = 0; i < rest.length - 1; i++) {
                if (node[rest[i]] == null || typeof node[rest[i]] !== "object") node[rest[i]] = {};
                node = node[rest[i]];
            }
            node[rest[rest.length - 1]] = clone(value);
        }
        schedule(d);
        notify(path);
        return true;
    }

    function del(path) {
        const [d, ...rest] = split(path);
        if (!cache[d]) return;
        if (!rest.length) {
            cache[d] = clone(DEFAULTS[d]);
        } else {
            let node = cache[d];
            for (let i = 0; i < rest.length - 1; i++) {
                node = node[rest[i]];
                if (node == null || typeof node !== "object") return;
            }
            delete node[rest[rest.length - 1]];
        }
        schedule(d);
        notify(path);
    }

    // subscribe to a path; returns an unsubscribe function
    function onChange(path, fn) {
        const entry = { path, fn };
        listeners.push(entry);
        return () => {
            const i = listeners.indexOf(entry);
            if (i >= 0) listeners.splice(i, 1);
        };
    }

    function onError(fn) { errorListeners.push(fn); }

    // write any pending changes immediately
    function flush() {
        [...dirty].forEach(writeDomain);
    }

    // list entries of a keyed collection (characters / levels), newest first
    function list(domain) {
        const obj = cache[domain] || {};
        return Object.entries(obj)
            .map(([uid, v]) => ({ uid, ...clone(v) }))
            .sort((a, b) => (b.saved || 0) - (a.saved || 0));
    }

    function newUid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // whole-site backup
    function exportAll() {
        flush();
        return JSON.stringify({ version: VERSION, data: clone(cache) });
    }

    function importAll(json) {
        let parsed;
        try { parsed = JSON.parse(json); } catch { return { ok: false, error: "Not valid JSON" }; }
        if (!parsed || parsed.version !== VERSION || typeof parsed.data !== "object") {
            return { ok: false, error: "Wrong or missing version" };
        }
        for (const d of DOMAINS) {
            cache[d] = parsed.data[d] ? clone(parsed.data[d]) : clone(DEFAULTS[d]);
            writeDomain(d);
            notify(d);
        }
        return { ok: true };
    }

    function reset() {
        wipeAll(false);
        for (const d of DOMAINS) {
            cache[d] = clone(DEFAULTS[d]);
            notify(d);
        }
    }

    // approximate bytes used by this site's saves
    function usage() {
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIX)) n += k.length + (localStorage.getItem(k) || "").length;
        }
        return n * 2; // UTF-16
    }

    init();
    return {get, set, delete: del, onChange, onError, flush, list, newUid, exportAll, importAll, reset, usage };
})();