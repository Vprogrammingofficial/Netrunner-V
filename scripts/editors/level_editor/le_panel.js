// le_panel.js - the level editor sidebar: tool list, floor properties, connection properties and the
// "add ..." forms. Built with DOM nodes + textContent only (no innerHTML), so names can't inject markup.
//
// The panel only rebuilds when what it shows changes (see render()), so typing into the DV field - which
// saves on every keystroke - never steals focus.

const LEPanel = (() => {
    const TOOLS = [
        { id: "select", label: "SELECT (S)" },
        { id: "floor", label: "FLOOR (F)" },
        { id: "connection", label: "CONNECTION (C)" },
        { id: "delete", label: "DELETE (T)" },
    ];
    const ICE_STATS = ["per", "spd", "atk", "def", "hp"];

    let header = null;
    let body = null;
    let mode = "main";   // floor panel sub-view: main | file | control | ice | netrunner
    let sig = null;      // signature of what's currently drawn
    let lastSel = "";

    // ---------- tiny DOM helpers ----------
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function btn(label, onClick, cls) {
        const b = el("div", "sh-button le-btn" + (cls ? " " + cls : ""), label);
        b.addEventListener("click", onClick);
        return b;
    }

    function input(type, value, opts = {}) {
        const i = el("input", "le-property-input");
        i.type = type;
        i.value = value;
        i.spellcheck = false;
        if (opts.min !== undefined) i.min = opts.min;
        if (opts.max !== undefined) i.max = opts.max;
        if (opts.placeholder) i.placeholder = opts.placeholder;
        if (opts.maxLength) i.maxLength = opts.maxLength;
        return i;
    }

    function field(label, inputEl) {
        body.append(el("label", "le-property-label", label), inputEl);
    }

    function setMode(m) {
        mode = m;
        render();
    }

    // svg strings come from content packs: show them as <img> data URLs so they can never run script
    function svgIcon(svg) {
        const holder = el("div", "le-pick__icon");
        if (typeof svg === "string" && svg) {
            const img = document.createElement("img");
            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
            img.alt = "";
            holder.appendChild(img);
        }
        return holder;
    }

    function itemName(item) {
        if (item.type === "ice") {
            const def = Content.get("programs", item.id);
            return def ? def.name : `${item.name} (MISSING)`;
        }
        if (item.type === "netrunner") return item.char.name;
        return item.name;
    }

    // ---------- views ----------
    function viewTools(v) {
        header.textContent = "TOOLS";
        for (const t of TOOLS) body.appendChild(btn(t.label, () => LEState.setTool(t.id), v.tool === t.id ? "active" : ""));
        const ins = el("div", "le-instructions");
        ins.append(el("div", null, "RIGHT CLICK + DRAG TO PAN"), el("div", null, "SCROLL TO ZOOM"));
        body.appendChild(ins);
    }

    function viewConnection(conn) {
        header.textContent = "CONNECTION";
        const dv = input("number", conn.dv, { min: 0 });
        dv.addEventListener("input", () => LEState.setConnectionDv(conn.id, dv.value));
        field("Difficulty Value (DV)", dv);
        body.appendChild(btn("BACK", () => LEState.select(null), "le-btn--gap"));
    }

    function formNamed(floor, kind) {
        header.textContent = kind === "file" ? "ADD FILE" : "ADD CONTROL NODE";
        const name = input("text", "", { placeholder: kind === "file" ? "Enter file name" : "Enter control node name", maxLength: 40 });
        const dv = input("number", 0, { min: 0 });
        field(kind === "file" ? "File Name" : "Control Node Name", name);
        field("Difficulty Value (DV)", dv);

        const save = () => {
            const n = name.value.trim();
            if (!n) { name.focus(); return; }
            mode = "main"; // set first: the state's change notification redraws the panel
            LEState.addContent(floor.id, { type: kind, name: n, dv: dv.value });
        };
        for (const i of [name, dv]) i.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
        body.append(btn("SAVE", save, "le-btn--gap"), btn("CANCEL", () => setMode("main")));
        name.focus();
    }

    function formIce(floor) {
        header.textContent = "SELECT BLACK ICE";
        const list = Content.getActive().programs.filter(p => p.type === "black_ice");

        if (!list.length) body.appendChild(el("div", "le-empty", "NO BLACK ICE LOADED"));
        for (const ice of list) {
            const row = el("div", "le-pick le-pick--ice");
            row.title = ice.desc || "";
            const text = el("div", "le-pick__text");
            text.appendChild(el("div", "le-pick__name", ice.name));
            const meta = ICE_STATS.filter(k => ice[k] != null).map(k => `${k.toUpperCase()} ${ice[k]}`).join(" | ");
            if (meta) text.appendChild(el("div", "le-pick__meta", meta));
            row.append(text, svgIcon(ice.svg));
            row.addEventListener("click", () => {
                mode = "main";
                LEState.addContent(floor.id, { type: "ice", id: ice.id, name: ice.name });
            });
            body.appendChild(row);
        }
        body.appendChild(btn("BACK", () => setMode("main"), "le-btn--gap"));
    }

    function formNetrunner(floor) {
        header.textContent = "ADD NETRUNNER";

        // where the netrunner's loadout can come from
        const sources = [{ label: "DEFAULT NETRUNNER", get: () => LEState.defaultChar() }];
        if (typeof NEState !== "undefined") sources.push({ label: "CURRENT EDITOR DRAFT", get: () => NEState.exportData() });
        for (const entry of Store.list("characters")) sources.push({ label: entry.name || "UNNAMED", get: () => entry });

        let pending = LEState.defaultChar();

        body.appendChild(el("label", "le-property-label", "SOURCE"));
        const list = el("div", "le-picklist");
        const rows = [];
        const name = input("text", pending.name, { maxLength: 24 });
        const team = input("number", 0, { min: 0, max: 20 });

        sources.forEach((src, i) => {
            const row = el("div", "le-pick" + (i === 0 ? " active" : ""));
            row.appendChild(el("div", "le-pick__name", src.label));
            row.addEventListener("click", () => {
                pending = LEState.cleanChar(src.get());
                name.value = pending.name; // team stays as typed
                rows.forEach(r => r.classList.toggle("active", r === row));
            });
            rows.push(row);
            list.appendChild(row);
        });
        body.appendChild(list);

        field("Name", name);
        field("Team (0-20, 0 = NET)", team);

        body.append(
            btn("SAVE", () => {
                mode = "main";
                LEState.addContent(floor.id, { type: "netrunner", char: { ...pending, name: name.value, team: team.value } });
            }, "le-btn--gap"),
            btn("CANCEL", () => setMode("main"))
        );
    }

    function contentsList(floor) {
        body.appendChild(el("div", "le-section-title", "CONTENTS"));
        if (!floor.contents.length) body.appendChild(el("div", "le-empty", "EMPTY"));

        for (const item of floor.contents) {
            const card = el("div", "le-item");
            card.appendChild(el("div", null, `${item.type.toUpperCase()}: ${itemName(item)}`));
            if (item.type === "file" || item.type === "control") {
                card.appendChild(el("div", "le-item__meta", `DV: ${item.dv}`));
            } else if (item.type === "netrunner") {
                const c = item.char;
                card.appendChild(el("div", "le-item__meta", `TEAM ${c.team} | HP ${c.chp}/${c.hp} | INT ${c.interface}`));
            }
            card.appendChild(btn("REMOVE", () => LEState.removeContent(floor.id, item.uid), "le-btn--small"));
            body.appendChild(card);
        }
    }

    function viewFloor(floor) {
        if (mode === "file" || mode === "control") return formNamed(floor, mode);
        if (mode === "ice") return formIce(floor);
        if (mode === "netrunner") return formNetrunner(floor);

        header.textContent = floor.type === "entrance" ? "ENTRANCE" : "FLOOR NODE";
        body.append(
            btn("BACK", () => LEState.select(null)),
            btn("ADD FILE", () => setMode("file")),
            btn("ADD CONTROL NODE", () => setMode("control")),
            btn("ADD BLACK ICE", () => setMode("ice")),
            btn("ADD NETRUNNER", () => setMode("netrunner"))
        );
        if (floor.type !== "entrance") body.appendChild(btn(floor.core ? "REMOVE CORE" : "ADD CORE", () => LEState.toggleCore(floor.id)));
        contentsList(floor);
    }

    // ---------- render / lifecycle ----------
    function render() {
        if (!body) return;
        const v = LEState.getView();

        const selKey = v.selected ? v.selected.kind + ":" + v.selected.id : "";
        if (selKey !== lastSel) { lastSel = selKey; mode = "main"; }

        const floor = v.selected && v.selected.kind === "floor" ? v.floors.find(f => f.id === v.selected.id) : null;
        const conn = v.selected && v.selected.kind === "connection" ? v.connections.find(c => c.id === v.selected.id) : null;

        let s, build;
        if (floor) {
            s = `floor:${floor.id}:${mode}:${floor.core}:${floor.contents.map(c => c.uid).join(",")}`;
            build = () => viewFloor(floor);
        } else if (conn) {
            s = "conn:" + conn.id; // DV is deliberately not part of this
            build = () => viewConnection(conn);
        } else {
            s = "tools:" + v.tool;
            build = () => viewTools(v);
        }

        if (s === sig) return;
        sig = s;
        body.replaceChildren();
        build();
    }

    // force a rebuild next render (content packs toggled, etc.)
    function invalidate() { sig = null; }

    function init(root) {
        root.replaceChildren();
        header = el("div", "le-header");
        body = el("div", "le-body");
        root.append(header, body);
    }

    return { init, render, invalidate };
})();
