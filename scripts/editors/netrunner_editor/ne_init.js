// ne_init.js - wires the netrunner maker screen (screen-ne).
// Load order: storage, screenmaster, saveload, contentLoader, packs, ne_state, ne_render, ne_dragdrop, ne_init.

(function() {
    const $ = id => document.getElementById(id);

    // save/load popup adapter (see saveload.js). Saves are stored flat so the level editor can use them as sources.
    const SL_ADAPTER = {
        kind: "char",
        domain: "characters",
        title: "NETRUNNER SAVE / LOAD",
        listLabel: "SAVED NETRUNNERS",
        hasName: false,
        getName: () => NEState.exportData().name,
        export: () => NEState.exportData(),
        import(data) {
            if (!data || typeof data !== "object" || !Array.isArray(data.installed)) return { ok: false, error: "NOT A NETRUNNER" };
            const dropped = NEState.importData(data);
            NERender.flashDropped(dropped);
            return { ok: true, note: dropped.length ? `${dropped.length} ITEM(S) REMOVED` : "" };
        },
        subscribe: fn => NEState.subscribe(fn),
        entryName: e => e.name,
        makeEntry: (name, data) => ({ ...data, saved: Date.now() }),
        entryData: e => { const { uid, saved, ...d } = e; return d; },
    };

    function wireStats() {
        for (const [key, id] of Object.entries(NERender.STAT_INPUTS)) {
            const input = $(id);
            if (!input) { console.warn("[ne] missing stat input #" + id); continue; }
            input.addEventListener("change", () => {
                NEState.setStats({
                    [key]: input.value });
                input.value = NEState.getView().stats[key]; // show the clamped value
            });
            input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); });
        }
    }

    function wireSidebar() {
        const sidebar = $("ne-sidebar");

        // click a deck to select it
        sidebar.addEventListener("click", e => {
            const c = e.target.closest(".ne-card");
            if (!c || c.dataset.kind !== "deck") return;
            NERender.flashDropped(NEState.selectDeck(c.dataset.id));
        });

        // double-click a program/hardware to install it (touch / no-drag fallback)
        sidebar.addEventListener("dblclick", e => {
            const c = e.target.closest(".ne-card");
            if (!c || c.dataset.kind === "deck") return;
            const r = NEState.install(c.dataset.kind, c.dataset.id);
            if (!r.ok) NERender.flash(r.reason);
            else NERender.flashDropped(r.dropped);
        });
    }

    function wireRemove() {
        $("ne-main").addEventListener("click", e => {
            const b = e.target.closest("[data-remove]");
            if (!b) return;
            const dropped = b.dataset.scope === "external" ?
                NEState.removeExternal(b.dataset.remove) :
                NEState.remove(b.dataset.remove);
            NERender.flashDropped(dropped);
        });
    }

    function init() {
        wireStats();
        wireSidebar();
        wireRemove();
        NEDragDrop.init();

        const sl = $("ne-saveload");
        if (sl) sl.addEventListener("click", () => SaveLoad.open(SL_ADAPTER));

        const reset = $("ne-reset");
        if (reset) reset.addEventListener("click", () => NEState.reset());

        NEState.subscribe(NERender.render);

        // pack toggled while this screen exists: revalidate. Only matters when visible.
        Content.onChange(() => {
            if (!$("screen-ne").classList.contains("active")) return;
            NERender.flashDropped(NEState.refreshContent());
        });
    }

    function enter() {
        const dropped = NEState.load();
        NERender.render();
        NERender.flashDropped(dropped);
    }

    registerScreen("screen-ne", { init, enter });
})();
