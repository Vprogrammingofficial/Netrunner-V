const canvas = document.getElementById('matrix');
const ctx = canvas.getContext('2d');

const W = window.innerWidth;
const H = window.innerHeight;
canvas.width = W;
canvas.height = H;

const chars = '01';
const centerX = W / 2;
const baseSize = 16;
const minSize = 5;

const columns = [];
let x = 0;

while (x < W) {
    const dist = Math.abs(x - centerX);
    const t = Math.min(1, dist / (W / 2)); // 0 at center, 1 at edges
    const size = Math.round(minSize + t * (baseSize - minSize));
    const opacity = 0.05 + t * 0.95;

    // Trail fade: strong near center (trails vanish fast), gentle at edges
    const fade = 0.05 + (1 - t) * 0.25;

    const width = size * 0.85;
    columns.push({ x, width, size, drop: Math.random() * 30, opacity, fade });
    x += width;
}

function draw() {
    for (const col of columns) {
        // Per-column fade of the trail, based on distance from center
        ctx.fillStyle = `rgba(0,0,0,${col.fade})`;
        ctx.fillRect(Math.floor(col.x), 0, Math.ceil(col.width) + 1, H);

        const char = chars[Math.floor(Math.random() * 2)];
        const bright = Math.random() > 0.95;
        const alpha = bright ? Math.min(1, col.opacity + 0.3) : col.opacity;
        ctx.fillStyle = bright ?
            `rgba(255,255,255,${alpha})` :
            `rgba(0,204,68,${alpha})`;
        ctx.font = `${col.size}px monospace`;
        ctx.fillText(char, col.x, col.drop * col.size);

        if (col.drop * col.size > H && Math.random() > 0.975) col.drop = 0;
        col.drop++;
    }
}

ctx.fillStyle = '#000';
ctx.fillRect(0, 0, W, H);
setInterval(draw, 40);