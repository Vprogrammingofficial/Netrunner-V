// test_pack.js - small pack that exercises every part of the netrunner maker.
//
// ITEM FORMAT
//   common:    id (lowercase/digits/_), name, desc, cost (eddies)
//   deck:      slots: { uv, pr, hw }   uv = universal, pr = program-only, hw = hardware-only (total 1-9)
//   program:   type (booster|defender|attacker|black_ice), sl (slots used), hp, + optional atk/def/per/spd
//   hardware:  sl (slots used)
//
// MAKER RULE HOOKS (optional, on any deck or hardware item):
//   maker: { onProgramAdd(ctx) }
//     ctx = { program, deck, installed: [{ uid, def, kind, sl }], external: [hardwareDefs] }
//     return { ok: true }                      -> allowed
//            { ok: true, sl: n }               -> allowed, but takes n slots (lowest value from all hooks wins)
//            { ok: false, reason: "text" }     -> rejected
//
// Runtime/game hooks (onUse, onAttack...) will live in a separate `game` object later.

Content.register({
    id: "test_pack",
    name: "Test Pack",
    version: "1.0.0",
    dependencies: [],

    decks: [{
            id: "dk_test_basic",
            name: "Basic Deck",
            desc: "4 universal slots. No special rules.",
            cost: 100,
            slots: { uv: 4, pr: 0, hw: 0 },
        },
        {
            id: "dk_test_split",
            name: "Split Deck",
            desc: "2 universal, 3 program-only, 2 hardware-only.",
            cost: 400,
            slots: { uv: 2, pr: 3, hw: 2 },
        },
        {
            id: "dk_test_max",
            name: "Maxed Deck",
            desc: "9 slots: 3 program-only, 3 universal, 3 hardware-only.",
            cost: 1000,
            slots: { uv: 3, pr: 3, hw: 3 },
        },
        {
            id: "dk_test_sandbox",
            name: "Sandbox Deck",
            desc: "5 universal slots. Refuses black ice.",
            cost: 250,
            slots: { uv: 5, pr: 0, hw: 0 },
            maker: {
                onProgramAdd(ctx) {
                    if (ctx.program.type === "black_ice") return { ok: false, reason: "Sandbox Deck refuses black ice." };
                    return { ok: true };
                },
            },
        },
    ],

    programs: [{
            id: "bs_test_boost",
            type: "booster",
            name: "Test Booster",
            desc: "1 slot booster.",
            cost: 20,
            sl: 1,
            hp: 7,
        },
        {
            id: "df_test_shield",
            type: "defender",
            name: "Test Shield",
            desc: "1 slot defender.",
            cost: 50,
            sl: 1,
            hp: 7,
        },
        {
            id: "at_test_spike",
            type: "attacker",
            name: "Test Spike",
            desc: "1 slot attacker.",
            cost: 50,
            sl: 1,
            hp: 7,
            atk: 1,
        },
        {
            id: "at_test_heavy",
            type: "attacker",
            name: "Test Heavy",
            desc: "2 slot attacker. Good for testing the Compression Chip.",
            cost: 150,
            sl: 2,
            hp: 10,
            atk: 3,
        },
        {
            id: "bi_test_hound",
            type: "black_ice",
            name: "Test Hound",
            desc: "2 slot black ice.",
            cost: 100,
            sl: 2,
            hp: 15,
            per: 4,
            spd: 6,
            atk: 2,
            def: 2,
            targets: ["nr"],
        },
    ],

    hardware: [{
            id: "hw_test_plug",
            name: "Test Plug",
            desc: "1 slot, no effects.",
            cost: 100,
            sl: 1,
        },
        {
            id: "hw_test_compress",
            name: "Compression Chip",
            desc: "Programs that use 2 or more slots use 1 fewer.",
            cost: 300,
            sl: 1,
            maker: {
                onProgramAdd(ctx) {
                    return { ok: true, sl: Math.max(1, ctx.program.sl - 1) };
                },
            },
        },
        {
            id: "hw_test_single",
            name: "Single Attacker Rig",
            desc: "Only one attacker program may be installed.",
            cost: 200,
            sl: 1,
            maker: {
                onProgramAdd(ctx) {
                    if (ctx.program.type !== "attacker") return { ok: true };
                    const has = ctx.installed.some(i => i.kind === "program" && i.def.type === "attacker");
                    return has ? { ok: false, reason: "Single Attacker Rig allows only one attacker." } : { ok: true };
                },
            },
        },
    ],

    effects: [{
        id: "ef_test",
        name: "Test Effect",
        desc: "Placeholder effect.",
    }],

    actions: [{
        id: "ac_test",
        name: "Test Action",
        desc: "Placeholder action.",
        actcost: 1,
    }],
});
