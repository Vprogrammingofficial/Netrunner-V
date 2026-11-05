// le_input.js - mouse + keyboard for the level editor canvas. Turns input into LEState / LECamera calls.

const LEInput = (() => {
    const KEYS = { s: "select", f: "floor", c: "connection", t: "delete" };

    let canvas = null;
    let drag = null; // { type: "pan", x, y } | { type: "move", id, dx, dy }

    const isActive = () => {
        const s = document.getElementById("screen-le");
        return !!s && s.classList.contains("active");
    };

    function local(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onDown(e) {
        if (e.button === 2) {
            drag = { type: "pan", x: e.clientX, y: e.clientY };
            canvas.classList.add("grabbing");
            return;
        }
        if (e.button !== 0) return;

        const p = local(e);
        const w = LECamera.toWorld(p.x, p.y);
        const v = LEState.getView();

        switch (v.tool) {
            case "select": {
                const floor = LEState.floorAt(w.x, w.y);
                if (floor) {
                    LEState.select({ kind: "floor", id: floor.id });
                    // remember the grab offset so the floor doesn't jump to the cursor
                    if (floor.type !== "entrance") drag = { type: "move", id: floor.id, dx: floor.x - w.x, dy: floor.y - w.y };
                    return;
                }
                const conn = LEState.connectionAt(w.x, w.y);
                LEState.select(conn ? { kind: "connection", id: conn.id } : null);
                return;
            }
            case "floor":
                LEState.addFloor(w.x, w.y);
                return;
            case "connection": {
                const floor = LEState.floorAt(w.x, w.y);
                if (!floor) { LEState.setConnecting(null); return; } // click empty space cancels
                if (v.connecting === null) {
                    LEState.setConnecting(floor.id);
                } else if (v.connecting !== floor.id) {
                    LEState.addConnection(v.connecting, floor.id);
                    LEState.setConnecting(null);
                }
                return;
            }
            case "delete": {
                const floor = LEState.floorAt(w.x, w.y);
                if (floor) { LEState.deleteFloor(floor.id); return; } // entrance is refused by the state
                const conn = LEState.connectionAt(w.x, w.y);
                if (conn) LEState.deleteConnection(conn.id);
                return;
            }
        }
    }

    // move/up live on window so releasing outside the canvas can't leave a drag stuck
    function onMove(e) {
        if (!drag) return;
        if (drag.type === "pan") {
            LECamera.panBy(e.clientX - drag.x, e.clientY - drag.y);
            drag.x = e.clientX;
            drag.y = e.clientY;
        } else {
            const p = local(e);
            const w = LECamera.toWorld(p.x, p.y);
            LEState.moveFloor(drag.id, w.x + drag.dx, w.y + drag.dy);
        }
    }

    function endDrag() {
        if (!drag) return;
        if (drag.type === "pan") LECamera.save();
        else LEState.endMove();
        drag = null;
        canvas.classList.remove("grabbing");
    }

    function onWheel(e) {
        e.preventDefault();
        const p = local(e);
        LECamera.zoomAt(p.x, p.y, e.deltaY > 0 ? 0.9 : 1.1);
        LECamera.save();
    }

    function onKey(e) {
        if (!isActive()) return;
        const t = e.target && e.target.tagName;
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return; // leave Ctrl+C etc. alone

        const k = e.key.toLowerCase();
        if (KEYS[k]) { LEState.setTool(KEYS[k]); return; }

        if (k === "escape") {
            LEState.setConnecting(null);
            LEState.select(null);
            return;
        }

        if (k === "delete" || k === "backspace") {
            const s = LEState.getView().selected;
            if (!s) return;
            e.preventDefault();
            if (s.kind === "floor") LEState.deleteFloor(s.id);
            else LEState.deleteConnection(s.id);
        }
    }

    function init(c) {
        canvas = c;
        canvas.addEventListener("mousedown", onDown);
        canvas.addEventListener("contextmenu", e => e.preventDefault());
        canvas.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", endDrag);
        window.addEventListener("blur", endDrag);
        document.addEventListener("keydown", onKey);
    }

    return { init };
})();
