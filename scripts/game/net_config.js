// net_config.js - optional network settings. Load BEFORE net.js (see index.html).
//
// A TURN server relays traffic when two browsers can't reach each other directly (mobile data, strict routers,
// school/work networks, some VPNs). Without one, "negotiation of connection failed" is expected on those networks.
// Hosting and connecting both read these settings, so every player needs the same file.
//
// Anything you put here is public (the page is static), so use a provider's free tier, not an account you care about.

window.NET_CONFIG = {
    turn: [
        // { urls: "turn:YOUR-TURN-HOST:3478",  username: "USER", credential: "PASSWORD" },
        // { urls: "turns:YOUR-TURN-HOST:443?transport=tcp", username: "USER", credential: "PASSWORD" },
    ],
};
