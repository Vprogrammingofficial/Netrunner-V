// le_init.js - wires the level editor screen (screen-le).
// Load order: storage, screenmaster, saveload, contentLoader, packs, ne_* (optional), le_assets, le_state, le_camera,
// le_render, le_panel, le_input, le_init.

(function () {
    const $ = id => document.getElementById(id);
    const isActive = () => $("screen-le").classList.contains("active");

    // save/load popup adapter (see saveload.js). The level name is UI-only, kept at session.leName.
    const NAME_PATH = "session.leName";
    const SL_ADAPTER = {
        kind: "level",
        domain: "levels",
        title: "LEVEL SAVE / LOAD",
        listLabel: "SAVED LEVELS",
        hasName: true,
        defaultName: "Untitled Level",
        getName: () => Store.get(NAME_PATH, ""),
        setName: n => Store.set(NAME_PATH, n),
        export: () => LEState.exportData(),
        import(data) {
            if (!data || !Array.isArray(data.floors)) return { ok: false, error: "NOT A LEVEL" };
            LEState.loadData(data);
            return { ok: true };
        },
        subscribe: fn => LEState.subscribe(fn),
        entryName: e => e.name,
        makeEntry: (name, data) => ({ name, saved: Date.now(), data }),
        entryData: e => e.data,
    };

    function addCanvasControls(host) {
        const bar = document.createElement("div");
        bar.className = "le-controls";
        for (const [label, fn] of [["RESET ZOOM", LECamera.resetZoom], ["RECENTER", LECamera.recenter]]) {
            const b = document.createElement("div");
            b.className = "sh-button";
            b.textContent = label;
            b.addEventListener("click", () => { fn(); LECamera.save(); });
            bar.appendChild(b);
        }
        host.appendChild(bar);
    }

    function init() {
        const canvas = $("level_editor");
        LERender.init(canvas);
        LECamera.init(LERender.size);
        LEInput.init(canvas);
        LEPanel.init($("le-sidebar"));
        addCanvasControls($("le-main"));

        if (window.ResizeObserver) new ResizeObserver(() => LERender.resize()).observe($("le-main"));
        window.addEventListener("resize", LERender.resize);

        const sl = $("le-saveload");
        if (sl) sl.addEventListener("click", () => SaveLoad.open(SL_ADAPTER));

        const reset = $("le-reset");
        if (reset) {
            reset.addEventListener("click", () => {
                const v = LEState.getView();
                const dirty = v.floors.length > 1 || v.connections.length > 0 || v.floors[0].contents.length > 0;
                if (dirty && !confirm("Clear this level?")) return;
                LEState.reset();
            });
        }

        LEState.subscribe(LEPanel.render);

        // pack toggled: ICE lists and "missing" labels may change
        Content.onChange(() => {
            if (!isActive()) return;
            LEAssets.load();
            LEPanel.invalidate();
            LEPanel.render();
        });
    }

    function enter() {
        LEState.load();
        LERender.resize();
        LEAssets.load();
        LEPanel.invalidate();
        LEPanel.render();
        LERender.start();
    }

    registerScreen("screen-le", { init, enter });
})();
