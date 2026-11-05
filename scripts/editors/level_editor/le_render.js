// le_render.js - draws the level editor canvas from LEState + LECamera. No editing logic here.

const LERender = (() => {
    const COL = { main: "#00ff41", entrance: "#ff0066", fill: "#1a1a1a", bg: "#0a0a0a", sel: "#ffffff" };

    let canvas = null;
    let ctx = null;
    let running = false;

    const isActive = () => {
        const s = document.getElementById("screen-le");
        return !!s && s.classList.contains("active");
    };

    function init(c) {
        canvas = c;
        ctx = c.getContext("2d");
    }

    function size() {
        return { w: canvas ? canvas.width : 1, h: canvas ? canvas.height : 1 };
    }

    // match the drawing buffer to the visible size of the canvas area
    function resize() {
        if (!canvas) return;
        const p = canvas.parentElement;
        const w = p.clientWidth, h = p.clientHeight;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }

    function drawConnection(c, byId, selected) {
        const a = byId.get(c.from), b = byId.get(c.to);
        if (!a || !b) return;
        const z = LECamera.zoom;
        const p1 = LECamera.toScreen(a.x, a.y);
        const p2 = LECamera.toScreen(b.x, b.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = COL.main;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(mx, my, LEState.NODE_R * z, 0, Math.PI * 2);
        ctx.fillStyle = COL.fill;
        ctx.fill();
        ctx.strokeStyle = selected && selected.kind === "connection" && selected.id === c.id ? COL.sel : COL.main;
        ctx.lineWidth = 2;
        ctx.stroke();

        if (c.dv > 0) LEAssets.draw(ctx, "lock", mx, my, 20 * z);
    }

    function drawFloor(f, selected) {
        const z = LECamera.zoom;
        const p = LECamera.toScreen(f.x, f.y);
        const r = LEState.FLOOR_R * z;

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = f.type === "entrance" ? COL.entrance : COL.main;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = COL.fill;
        ctx.fill();

        if (selected && selected.kind === "floor" && selected.id === f.id) {
            ctx.strokeStyle = COL.sel;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        if (f.core) LEAssets.draw(ctx, "core", p.x, p.y, 60 * z);

        const n = f.contents.length;
        f.contents.forEach((item, i) => {
            const a = (i / n) * Math.PI * 2;
            LEAssets.draw(ctx, LEAssets.iconKey(item), p.x + Math.cos(a) * r * 0.6, p.y + Math.sin(a) * r * 0.6, 25 * z);
        });
    }

    function drawConnecting(f) {
        const p = LECamera.toScreen(f.x, f.y);
        ctx.strokeStyle = COL.sel;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (LEState.FLOOR_R + 5) * LECamera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function draw() {
        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const v = LEState.getView();
        const byId = new Map(v.floors.map(f => [f.id, f]));

        for (const c of v.connections) drawConnection(c, byId, v.selected);
        for (const f of v.floors) drawFloor(f, v.selected);
        if (v.connecting !== null && byId.has(v.connecting)) drawConnecting(byId.get(v.connecting));
    }

    // loop runs only while the level editor screen is visible
    function frame() {
        if (!running) return;
        if (!isActive()) { running = false; return; }
        draw();
        requestAnimationFrame(frame);
    }

    function start() {
        if (running) return;
        running = true;
        requestAnimationFrame(frame);
    }

    return { init, size, resize, start };
})();
