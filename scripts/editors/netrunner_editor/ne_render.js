// ne_render.js - draws the netrunner maker from NEState + Content. No game logic here.

const NERender = (() => {
    const $ = id => document.getElementById(id);

    const STAT_INPUTS = {
        name: "ne-stat-name",
        interface: "ne-stat-interface",
        hp: "ne-stat-hp",
        chp: "ne-stat-chp",
        team: "ne-stat-team",
    };

    const CELL_LABEL = { p: "PRG", u: "ANY", h: "HRD" };
    const CELL_CLASS = { p: "program", u: "any", h: "hardware" };

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function metaText(item) {
        if (item.kind === "deck") {
            const s = item.slots;
            return `${s.pr + s.uv + s.hw} SLOTS (${s.pr}P ${s.uv}U ${s.hw}H) | ${item.cost}eb`;
        }
        if (item.kind === "program") {
            const bits = [item.type.replace("_", " ").toUpperCase(), "SL " + item.sl, "HP " + item.hp];
            for (const k of ["atk", "def", "per", "spd"]) if (item[k] != null) bits.push(k.toUpperCase() + " " + item[k]);
            bits.push(item.cost + "eb");
            return bits.join(" | ");
        }
        return `SL ${item.sl} | ${item.cost}eb`;
    }

    function card(item, selected) {
        const c = el("div", "ne-card ne-card--" + item.kind + (selected ? " ne-card--selected" : ""));
        c.dataset.kind = item.kind;
        c.dataset.id = item.id;
        if (item.kind !== "deck") c.draggable = true;
        c.appendChild(el("div", "ne-card-name", item.name));
        c.appendChild(el("div", "ne-card-meta", metaText(item)));
        if (item.desc) c.appendChild(el("div", "ne-card-desc", item.desc));
        return c;
    }

    function fillList(id, items, selectedId) {
        const box = $(id);
        if (!box) return;
        box.replaceChildren();
        if (!items.length) { box.appendChild(el("div", "ne-empty", "NONE LOADED")); return; }
        for (const it of items) box.appendChild(card(it, it.id === selectedId));
    }

    function renderSidebar(v) {
        const a = Content.getActive();
        fillList("ne-decks", a.decks, v.deck && v.deck.id);
        fillList("ne-programs", a.programs);
        fillList("ne-hardware", a.hardware);
    }

    function renderStats(v) {
        for (const [key, id] of Object.entries(STAT_INPUTS)) {
            const input = $(id);
            if (!input || document.activeElement === input) continue; // don't fight the user while typing
            input.value = v.stats[key];
        }
    }

    function removeBtn(uid, scope) {
        const b = el("div", "ne-remove", "x");
        b.dataset.remove = uid;
        b.dataset.scope = scope;
        b.title = "Remove";
        return b;
    }

    const IND_CLASS = { p: "program", u: "universal", h: "hardware" };

    // old-style deck case: tabs on top, type indicator strip, rounded case with the deck name
    function renderDeckBox(v) {
        const box = $("ne-deckbox");
        if (!box) return;
        box.replaceChildren();

        if (!v.deck) {
            const empty = el("div", "deckbox__empty");
            empty.append("NO DECK SELECTED", document.createElement("br"), "PLEASE SELECT A DECK");
            box.appendChild(empty);
            return;
        }

        const total = Math.max(v.cells.length, 9);
        const cols = `repeat(${total}, 1fr)`;

        const stack = el("div", "deckbox__stack");

        // tabs
        const slots = el("div", "deckbox__slots");
        slots.style.gridTemplateColumns = cols;
        for (let i = 0; i < total; i++) {
            const c = v.cells[i];
            if (c && c.uid) {
                let j = i;
                while (j + 1 < v.cells.length && v.cells[j + 1].uid === c.uid) j++;
                const it = v.items.find(x => x.uid === c.uid);
                const tab = el("div", "deckbox__slot deckbox__slot--installed deckbox__slot--installed-" + it.kind);
                if (j > i) tab.style.gridColumn = `span ${j - i + 1}`;
                tab.title = it.sl < it.baseSl ? `${it.def.name} (SL ${it.sl}, was ${it.baseSl})` : it.def.name;
                tab.appendChild(el("span", "deckbox__item-name", it.def.name));
                const x = el("button", "deckbox__remove", "\u00d7");
                x.dataset.remove = it.uid;
                x.dataset.scope = "deck";
                x.title = "Remove";
                tab.appendChild(x);
                slots.appendChild(tab);
                i = j;
            } else {
                slots.appendChild(el("div", "deckbox__slot"));
            }
        }

        // colored type strip, one per slot unit
        const ind = el("div", "deckbox__indicators");
        ind.style.gridTemplateColumns = cols;
        for (let j = 0; j < total; j++) {
            const c = v.cells[j];
            ind.appendChild(el("div", "deckbox__indicator deckbox__indicator--" + (c ? IND_CLASS[c.kind] : "empty")));
        }

        // case
        const caseEl = el("div", "deckbox__case");
        caseEl.appendChild(el("span", null, v.deck.name.toUpperCase()));

        stack.append(slots, ind, caseEl);
        box.appendChild(stack);
    }

    function renderExternal(v) {
        const box = $("ne-external");
        if (!box) return;
        box.replaceChildren();
        if (!v.extItems.length) { box.appendChild(el("div", "ne-empty", "DROP HARDWARE HERE")); return; }
        for (const it of v.extItems) {
            const b = el("div", "ne-ext-item");
            b.appendChild(el("span", "ne-ext-name", it.def.name));
            b.appendChild(removeBtn(it.uid, "external"));
            box.appendChild(b);
        }
    }

    function render() {
        const v = NEState.getView();
        renderStats(v);
        renderSidebar(v);
        renderDeckBox(v);
        renderExternal(v);
    }

    let flashTimer = null;

    function flash(msg) {
        const f = $("ne-flash");
        if (!f) return;
        f.textContent = msg;
        f.style.display = "block";
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { f.style.display = "none"; }, 3000);
    }

    function flashDropped(list) {
        if (!list || !list.length) return;
        flash("Removed: " + list.map(d => `${d.name} (${d.reason})`).join(", "));
    }

    return { render, flash, flashDropped, STAT_INPUTS };
})();
