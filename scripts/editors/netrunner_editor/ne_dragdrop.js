// ne_dragdrop.js - drag cards from the sidebar onto the deck box or external hardware zone.

const NEDragDrop = (() => {
    let payload = null; // { kind, id }

    function setupZone(zone, onDrop) {
        zone.addEventListener("dragover", e => {
            if (!payload) return;
            e.preventDefault();
            zone.classList.add("ne-dropzone--over");
        });
        zone.addEventListener("dragleave", e => {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove("ne-dropzone--over");
        });
        zone.addEventListener("drop", e => {
            e.preventDefault();
            zone.classList.remove("ne-dropzone--over");
            if (!payload) return;
            const p = payload;
            payload = null;
            onDrop(p);
        });
    }

    function init() {
        const sidebar = document.getElementById("ne-sidebar");
        sidebar.addEventListener("dragstart", e => {
            const c = e.target.closest && e.target.closest(".ne-card");
            if (!c || c.dataset.kind === "deck") return;
            payload = { kind: c.dataset.kind, id: c.dataset.id };
            if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", c.dataset.kind + ":" + c.dataset.id); // Firefox needs data set
                e.dataTransfer.effectAllowed = "copy";
            }
        });
        sidebar.addEventListener("dragend", () => { payload = null; });

        setupZone(document.getElementById("ne-deckbox"), p => {
            const r = NEState.install(p.kind, p.id);
            if (!r.ok) NERender.flash(r.reason);
            else NERender.flashDropped(r.dropped);
        });

        setupZone(document.getElementById("ne-external-zone"), p => {
            if (p.kind !== "hardware") { NERender.flash("Only hardware can be installed externally."); return; }
            const r = NEState.installExternal(p.id);
            if (!r.ok) NERender.flash(r.reason);
            else NERender.flashDropped(r.dropped);
        });
    }

    return { init };
})();
