// le_assets.js - icon images for the level editor canvas.
// SVGs live in content packs: the `icons` collection (core icons are in cdpr_rd.js) and the
// optional `svg` field on black ice programs. Anything without an image falls back to a coloured
// square so the editor never breaks.

const LEAssets = (() => {
    const cache = {};   // key -> HTMLImageElement
    const pending = {}; // key -> Promise
    const failed = {};  // key -> true (don't retry / re-warn)

    function make(key, svg) {
        if (cache[key]) return Promise.resolve(cache[key]);
        if (failed[key]) return Promise.resolve(null);
        if (pending[key]) return pending[key];
        pending[key] = new Promise(resolve => {
            const img = new Image();
            const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
            img.onload = () => { cache[key] = img; URL.revokeObjectURL(url); delete pending[key]; resolve(img); };
            img.onerror = () => {
                console.warn("[le] SVG load failed:", key);
                failed[key] = true;
                URL.revokeObjectURL(url);
                delete pending[key];
                resolve(null);
            };
            img.src = url;
        });
        return pending[key];
    }

    // loads every active pack icon plus every active black ice svg. Safe to call repeatedly (cached).
    function load() {
        const a = Content.getActive();
        const jobs = [];
        for (const ic of a.icons) if (ic.svg) jobs.push(make(ic.id, ic.svg));
        for (const p of a.programs) {
            if (p.type === "black_ice" && typeof p.svg === "string" && p.svg) jobs.push(make("ice_" + p.id, p.svg));
        }
        return Promise.all(jobs);
    }

    function iconKey(item) {
        if (item.type === "ice") return "ice_" + item.id;
        if (item.type === "control") return "control";
        if (item.type === "netrunner") return "netrunner";
        return "file";
    }

    function draw(ctx, key, x, y, size) {
        const img = cache[key];
        if (!img) {
            ctx.fillStyle = (key.startsWith("ice_") || key === "netrunner" || key === "lock") ? "#ff0066" : "#00ff41";
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            return;
        }
        ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }

    return { load, iconKey, draw };
})();
