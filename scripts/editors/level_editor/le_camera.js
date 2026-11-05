// le_camera.js - pan / zoom math for the level editor canvas.
// The camera is stored as the world point at the centre of the canvas, so it survives window resizes.
// Persisted in Store at session.leView.

const LECamera = (() => {
    const PATH = "session.leView";
    const ZOOM_MIN = 0.1;
    const ZOOM_MAX = 5;

    const cam = { zoom: 1, cx: 0, cy: 0 };
    let size = () => ({ w: 1, h: 1 });

    const clampZoom = z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

    // sizeFn returns the canvas size: () => ({ w, h })
    function init(sizeFn) {
        size = sizeFn;
        const s = Store.get(PATH);
        if (s && Number.isFinite(s.zoom) && Number.isFinite(s.cx) && Number.isFinite(s.cy)) {
            cam.zoom = clampZoom(s.zoom);
            cam.cx = s.cx;
            cam.cy = s.cy;
        }
    }

    function toWorld(sx, sy) {
        const s = size();
        return { x: (sx - s.w / 2) / cam.zoom + cam.cx, y: (sy - s.h / 2) / cam.zoom + cam.cy };
    }

    function toScreen(wx, wy) {
        const s = size();
        return { x: (wx - cam.cx) * cam.zoom + s.w / 2, y: (wy - cam.cy) * cam.zoom + s.h / 2 };
    }

    function panBy(dxScreen, dyScreen) {
        cam.cx -= dxScreen / cam.zoom;
        cam.cy -= dyScreen / cam.zoom;
    }

    // zooms around a screen point so the world point under the cursor stays put
    function zoomAt(sx, sy, factor) {
        const before = toWorld(sx, sy);
        cam.zoom = clampZoom(cam.zoom * factor);
        const after = toWorld(sx, sy);
        cam.cx += before.x - after.x;
        cam.cy += before.y - after.y;
    }

    function resetZoom() { cam.zoom = 1; }

    function recenter() {
        cam.zoom = 1;
        cam.cx = 0;
        cam.cy = 0;
    }

    function save() { Store.set(PATH, { zoom: cam.zoom, cx: cam.cx, cy: cam.cy }); }

    return { init, toWorld, toScreen, panBy, zoomAt, resetZoom, recenter, save, get zoom() { return cam.zoom; } };
})();
