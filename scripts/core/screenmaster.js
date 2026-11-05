//screens hash-based routing so browser back/forward works
const HASH_TO_SCREEN = {
    "netrunnermaker": "screen-ne",
    "game": "screen-gm",
    "leveleditor": "screen-le",
    "gameloader": "screen-gl",
    "mainmenu": "screen-mm",
};

const SCREEN_TO_HASH = {};
for (const [hash, id] of Object.entries(HASH_TO_SCREEN)) {
    SCREEN_TO_HASH[id] = hash;
}

//each screen registers an init (first visit only) and enter (every visit) function
//e.g. registerScreen('screen-ne', { init: initNetrunnerMaker, enter: enterNetrunnerMaker })
const SCREEN_HOOKS = {};
const _screenInited = {};

function registerScreen(id, hooks) {
    SCREEN_HOOKS[id] = hooks;
}

//called every time a screen becomes active
function onScreenEnter(id) {
    Store.set("session.screen", id);

    const hooks = SCREEN_HOOKS[id];
    if (!hooks) return;
    if (hooks.init && !_screenInited[id]) {
        _screenInited[id] = true;
        hooks.init();
    }
    if (hooks.enter) hooks.enter();
}

//sets which screen is visible (no history, no hooks)
function _activate(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
}

//navs to screen adds history for b/f
function showScreen(id) {
    _activate(id);
    const hash = SCREEN_TO_HASH[id] || "mainmenu";
    if (location.hash !== "#" + hash) history.pushState(null, "", "#" + hash);
    onScreenEnter(id);
}

//syncs screen to any other hash change (back/forward)
window.addEventListener("hashchange", () => {
    const raw = location.hash.replace("#", "").toLowerCase();
    const id = HASH_TO_SCREEN[raw] || "screen-mm";
    _activate(id);
    onScreenEnter(id);
});

//popups
function showPopup(id) {
    document.getElementById(id).style.display = 'flex';
    Store.set("session.popup", id);
}

function hidePopup(id) {
    document.getElementById(id).style.display = 'none';
    if (Store.get("session.popup") === id) Store.delete("session.popup");
}

//restores screen + popup on reload. Call once, AFTER all screen scripts have registered.
function restoreSession() {
    const raw = location.hash.replace("#", "").toLowerCase();
    //hash wins if present, otherwise fall back to the last saved screen
    let id = HASH_TO_SCREEN[raw] || Store.get("session.screen") || "screen-mm";
    if (!document.getElementById(id)) id = "screen-mm";
    _activate(id);
    history.replaceState(null, "", "#" + (SCREEN_TO_HASH[id] || "mainmenu"));
    onScreenEnter(id);

    const popup = Store.get("session.popup");
    if (popup && document.getElementById(popup)) showPopup(popup);
    else Store.delete("session.popup");
}