// saveload.js - shared save/load popup (#pu-saveload) used by the level editor and the netrunner maker.
// Load AFTER storage.js and screenmaster.js. Each editor opens it with an adapter:
//
//   SaveLoad.open({
//     kind:        "level" | "char"           tags the code so a level code can't be loaded as a character
//     domain:      "levels" | "characters"    Store domain the saves live in
//     title:       header text,  listLabel: label above the saves list
//     hasName:     true to show the NAME row (level editor); otherwise the name comes from getName()
//     defaultName: name used when the name field is empty (only when hasName)
//     getName(), setName(n)                   current name (setName only used when hasName)
//     export()                                -> plain data for the current draft
//     import(data)                            -> { ok, error?, note? }  loads data into the editor
//     subscribe(fn)                           -> unsubscribe fn; fn runs whenever the draft changes
//     entryName(entry)                        -> display name of a Store entry
//     makeEntry(name, data)                   -> object to store
//     entryData(entry)                        -> plain data back out of a stored entry
//   })
//
// Code format: base64 of UTF-8 JSON  { k: kind, n?: name, d: data }.

const SaveLoad = (() => {
    const POPUP = "pu-saveload";
    const DEBOUNCE_MS = 300;
    const NAME_MAX = 40;
    const $ = id => document.getElementById(id);

    let adapter = null;
    let unsub = null;
    let wired = false;
    let timer = null;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    // ---------- code <-> object ----------
    function encode(env) {
        const bytes = new TextEncoder().encode(JSON.stringify(env));
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    function decode(text) {
        const bin = atob(text.replace(/\s+/g, ""));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const env = JSON.parse(new TextDecoder().decode(bytes));
        if (!env || typeof env !== "object" || typeof env.k !== "string") throw new Error("bad envelope");
        return env;
    }

    // ---------- small helpers ----------
    const isOpen = () => { const p = $(POPUP); return !!p && p.style.display === "flex"; };

    function setFeedback(msg, bad) {
        const f = $("sl-feedback");
        f.textContent = msg;
        f.style.color = bad ? "#ff4444" : "";
    }

    const currentName = () => String(adapter.getName() ?? "").trim().slice(0, NAME_MAX);

    function fmtDate(ts) {
        if (!ts) return "--";
        const d = new Date(ts);
        const p = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function buildCode() {
        return encode({ k: adapter.kind, n: adapter.hasName ? currentName() : undefined, d: adapter.export() });
    }

    // the box follows the draft, but never while the user is typing in it
    function refreshCode(force) {
        const ta = $("sl-code");
        if (!force && document.activeElement === ta) return;
        ta.value = buildCode();
    }

    function onState() {
        if (adapter && isOpen()) refreshCode(false);
    }

    // ---------- loading ----------
    function applyCode(text) {
        const trimmed = text.trim();
        if (!trimmed) { setFeedback(""); return; }

        let env;
        try { env = decode(trimmed); } catch { setFeedback("INVALID CODE", true); return; }
        if (env.k !== adapter.kind) { setFeedback(`WRONG CODE TYPE (EXPECTED ${adapter.kind.toUpperCase()})`, true); return; }

        const r = adapter.import(env.d);
        if (!r || !r.ok) { setFeedback((r && r.error) || "INVALID CODE", true); return; }

        if (adapter.hasName && typeof env.n === "string") {
            adapter.setName(env.n.slice(0, NAME_MAX));
            $("sl-name").value = currentName();
        }
        setFeedback("LOADED" + (r.note ? ` (${r.note})` : ""));
    }

    function loadEntry(entry) {
        const r = adapter.import(adapter.entryData(entry));
        if (!r || !r.ok) { setFeedback((r && r.error) || "COULD NOT LOAD", true); return; }
        if (adapter.hasName) {
            adapter.setName(adapter.entryName(entry) || "");
            $("sl-name").value = currentName();
        }
        refreshCode(true);
        setFeedback("LOADED" + (r.note ? ` (${r.note})` : ""));
    }

    // ---------- saving ----------
    function save() {
        let name = currentName();
        if (!name) {
            name = adapter.hasName ? (adapter.defaultName || "Untitled") : "Unnamed";
            if (adapter.hasName) { adapter.setName(name); $("sl-name").value = name; refreshCode(true); }
        }

        const existing = Store.list(adapter.domain).find(e => String(adapter.entryName(e) || "").toLowerCase() === name.toLowerCase());
        if (existing && !confirm(`Overwrite "${name}"?`)) return;

        const uid = existing ? existing.uid : Store.newUid();
        Store.set(adapter.domain + "." + uid, adapter.makeEntry(name, adapter.export()));
        Store.flush(); // writes now so a storage error shows up immediately
        renderList();
        setFeedback(existing ? "OVERWRITTEN" : "SAVED");
    }

    function remove(entry) {
        if (!confirm(`Delete "${adapter.entryName(entry) || "UNNAMED"}"?`)) return;
        Store.delete(adapter.domain + "." + entry.uid);
        renderList();
    }

    // ---------- list ----------
    function renderList() {
        const box = $("sl-list");
        box.replaceChildren();
        const entries = Store.list(adapter.domain);
        if (!entries.length) { box.appendChild(el("div", "sl-charlist__empty", "NO SAVES")); return; }

        for (const entry of entries) {
            const card = el("div", "sl-char-card");

            const info = el("div", "sl-char-card__info");
            info.appendChild(el("div", "sl-char-card__name", adapter.entryName(entry) || "UNNAMED"));
            info.appendChild(el("div", "sl-char-card__date", fmtDate(entry.saved)));
            card.appendChild(info);

            const actions = el("div", "sl-char-card__actions");
            const load = el("div", "sl-char-btn", "LOAD");
            load.addEventListener("click", () => loadEntry(entry));
            const del = el("div", "sl-char-btn sl-char-btn--delete", "DELETE");
            del.addEventListener("click", () => remove(entry));
            actions.append(load, del);
            card.appendChild(actions);

            box.appendChild(card);
        }
    }

    // ---------- popup ----------
    function wire() {
        if (wired) return;
        wired = true;

        $("sl-save").addEventListener("click", () => adapter && save());

        const ta = $("sl-code");
        ta.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => adapter && applyCode(ta.value), DEBOUNCE_MS);
        });
        ta.addEventListener("blur", () => { if (adapter && isOpen()) refreshCode(true); });

        $("sl-name").addEventListener("input", e => {
            if (!adapter || !adapter.hasName) return;
            adapter.setName(e.target.value.slice(0, NAME_MAX));
            refreshCode(false); // the name is part of the code
        });

        Store.onError(() => { if (isOpen()) setFeedback("STORAGE ERROR - SAVE FAILED", true); });
    }

    function open(a) {
        wire();
        if (unsub) unsub();
        adapter = a;
        unsub = a.subscribe(onState);

        $("sl-title").textContent = a.title;
        $("sl-list-label").textContent = a.listLabel;
        $("sl-name-row").style.display = a.hasName ? "" : "none";
        $("sl-name").value = a.hasName ? currentName() : "";

        refreshCode(true);
        renderList();
        setFeedback("");
        $(POPUP).style.display = "flex";
    }

    function close() {
        clearTimeout(timer);
        const p = $(POPUP);
        if (p) p.style.display = "none";
    }

    return { open, close, encode, decode, fmtDate };
})();
