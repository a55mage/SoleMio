/* Sole Mio — procedural weather scene (Canvas 2D, no dependencies) */
const Scene = (() => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const grey = (c, amt, dim) => mix(c, [lum(c) * dim, lum(c) * dim, lum(c) * dim * 1.04], amt);

    function rng(seed) {
        let s = seed >>> 0;
        return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    }

    // Sky keyframes by sun altitude (-1 deep night .. 1 noon): [alt, top, mid, horizon]
    const SKY = [
        [-1, [3, 6, 18], [7, 13, 36], [16, 26, 58]],
        [-0.25, [10, 16, 46], [46, 40, 90], [150, 80, 90]],
        [0, [36, 62, 130], [190, 110, 120], [255, 165, 85]],
        [0.25, [40, 108, 198], [115, 170, 225], [250, 212, 165]],
        [1, [22, 96, 208], [78, 158, 232], [186, 225, 250]],
    ];

    function skyAt(alt) {
        for (let i = 1; i < SKY.length; i++) {
            if (alt <= SKY[i][0]) {
                const a = SKY[i - 1], b = SKY[i], t = (alt - a[0]) / (b[0] - a[0]);
                return { top: mix(a[1], b[1], t), mid: mix(a[2], b[2], t), hor: mix(a[3], b[3], t) };
            }
        }
        const l = SKY[SKY.length - 1];
        return { top: l[1], mid: l[2], hor: l[3] };
    }

    let canvas, ctx, W = 0, H = 0, dpr = 1, raf = 0, last = 0;
    let P = null;            // current parameters
    let pal = null;          // derived palette
    let ground = null;       // pre-rendered landscape
    let moonSprite = null;
    let clouds = [], sprites = [], stars = [], drops = [], flakes = [], splashes = [], fogBlobs = [];
    let flash = 0, nextBolt = 4, bolt = null, shooting = null, nextShoot = 6;
    let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const horizonY = () => H * 0.74;

    function derive(p) {
        const alt = p.alt;
        const dayF = clamp((alt + 0.15) / 0.5);          // 0 night .. 1 day
        const nightF = clamp(-alt * 3.5);
        const sunset = clamp(1 - Math.abs(alt - 0.02) * 4.5) * (1 - p.cover * 0.6);
        const gloom = clamp(p.cover * 0.55 + p.rain * 0.45 + p.snow * 0.3 + (p.storm ? 0.35 : 0));
        let sky = skyAt(alt);
        const dim = p.storm ? 0.62 : 0.86;
        sky = { top: grey(sky.top, gloom, dim * 0.8), mid: grey(sky.mid, gloom, dim), hor: grey(sky.hor, gloom * 0.9, dim * 1.05) };

        // cloud lighting
        let light = mix([255, 255, 255], [70, 82, 118], nightF);
        let dark = mix([150, 166, 196], [14, 19, 36], nightF);
        light = mix(light, [255, 176, 120], sunset * 0.75);
        dark = mix(dark, [150, 98, 122], sunset * 0.65);
        const g = clamp(p.rain * 0.9 + p.cover * 0.35 + (p.storm ? 0.4 : 0));
        light = mix(light, grey(light, 1, 0.78), g * 0.8);
        dark = mix(dark, grey(dark, 1, 0.34), g);
        if (p.storm) { light = mix(light, [95, 100, 112], 0.5); dark = mix(dark, [24, 27, 36], 0.6); }

        // ground
        const snowAmt = p.snow > 0 ? clamp(0.35 + p.snow * 0.65) : 0;
        const gd = (day, night) => mix(night, day, dayF);
        let far = gd([96, 126, 156], [14, 22, 42]);
        let midG = gd([54, 88, 82], [9, 16, 28]);
        let near = gd([26, 50, 40], [5, 9, 16]);
        far = mix(far, sky.hor, 0.45);
        midG = mix(midG, sky.hor, 0.2);
        far = grey(far, gloom * 0.5, 0.9);
        midG = grey(midG, gloom * 0.5, 0.85);
        near = grey(near, gloom * 0.5, 0.8);
        const snowC = mix([232, 238, 250], [30, 38, 60], nightF);
        far = mix(far, snowC, snowAmt * 0.7);
        midG = mix(midG, snowC, snowAmt * 0.8);
        near = mix(near, mix(snowC, [200, 210, 228], 0.2), snowAmt * 0.85);
        return { alt, dayF, nightF, sunset, gloom, sky, light, dark, far, mid: midG, near, snowAmt };
    }

    /* ---------- sprites ---------- */
    function cloudSprite(w, h, seed, count, light, dark) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d'), r = rng(seed);
        const puffs = [];
        for (let i = 0; i < count; i++) {
            const t = r();
            const env = Math.sin(Math.PI * t);
            const rad = (0.1 + 0.16 * r()) * h * (0.55 + env * 0.75);
            const px = w * (0.1 + 0.8 * t);
            const py = h * 0.72 - env * h * 0.32 * r() - rad * 0.25;
            puffs.push({ px, py, rad });
        }
        puffs.sort((a, b) => b.py - a.py);
        const top = h * 0.1, bot = h * 0.85;
        for (const p of puffs) {
            const shade = clamp((p.py + p.rad * 0.3 - top) / (bot - top));
            const col = mix(light, dark, Math.pow(shade, 1.3) * 0.9);
            const g = x.createRadialGradient(p.px - p.rad * 0.25, p.py - p.rad * 0.35, p.rad * 0.05, p.px, p.py, p.rad);
            g.addColorStop(0, rgba(mix(col, light, 0.5), 0.96));
            g.addColorStop(0.55, rgba(col, 0.82));
            g.addColorStop(1, rgba(col, 0));
            x.fillStyle = g;
            x.beginPath(); x.arc(p.px, p.py, p.rad, 0, 7); x.fill();
        }
        return c;
    }

    function buildMoon(phase) {
        const s = 256, c = document.createElement('canvas');
        c.width = c.height = s;
        const x = c.getContext('2d'), R = s * 0.38, cx = s / 2, cy = s / 2;
        const r = rng(7);
        x.save();
        x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip();
        const g = x.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
        g.addColorStop(0, '#fbfbf4'); g.addColorStop(1, '#c9ccd2');
        x.fillStyle = g; x.fillRect(0, 0, s, s);
        for (let i = 0; i < 26; i++) {           // maria and craters
            const a = r() * 6.28, d = Math.sqrt(r()) * R * 0.92, rr = R * (0.05 + r() * 0.16);
            const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
            const cg = x.createRadialGradient(px, py, 0, px, py, rr);
            cg.addColorStop(0, 'rgba(120,125,140,.38)'); cg.addColorStop(1, 'rgba(120,125,140,0)');
            x.fillStyle = cg; x.beginPath(); x.arc(px, py, rr, 0, 7); x.fill();
        }
        // phase: shadow the unlit part
        const k = Math.cos(phase * Math.PI * 2);          // 1 new .. -1 full
        const waxing = phase < 0.5;
        x.fillStyle = 'rgba(6,9,20,.93)';
        if (!waxing) { x.translate(cx, 0); x.scale(-1, 1); x.translate(-cx, 0); }
        x.beginPath();
        x.arc(cx, cy, R + 1, -Math.PI / 2, Math.PI / 2, true);                 // shadowed left half
        x.ellipse(cx, cy, Math.abs(k) * (R + 1), R + 1, 0, Math.PI / 2, -Math.PI / 2, k > 0);
        x.fill();
        x.restore();
        return c;
    }

    function buildGround() {
        const c = document.createElement('canvas');
        c.width = W * dpr; c.height = H * dpr;
        const x = c.getContext('2d');
        x.scale(dpr, dpr);
        const hy = horizonY(), r = rng(42);
        const layer = (base, amp, fq, ph, col, haze) => {
            const g = x.createLinearGradient(0, base - amp, 0, H);
            g.addColorStop(0, rgba(col)); g.addColorStop(1, rgba(mix(col, [0, 0, 0], 0.35)));
            x.fillStyle = g;
            x.beginPath(); x.moveTo(0, H);
            for (let i = 0; i <= W; i += 4) {
                const n = Math.sin(i * fq + ph) * 0.55 + Math.sin(i * fq * 2.3 + ph * 1.7) * 0.3 + Math.sin(i * fq * 5.1 + ph * 0.4) * 0.15;
                x.lineTo(i, base - amp * (0.5 + 0.5 * n));
            }
            x.lineTo(W, H); x.closePath(); x.fill();
        };
        layer(hy + H * 0.015, H * 0.11, 0.0042, 1.0, pal.far);
        layer(hy + H * 0.075, H * 0.09, 0.0065, 3.2, pal.mid);
        // pines on mid ridge
        const pine = (px, py, s, col) => {
            x.fillStyle = rgba(col);
            for (let k = 0; k < 4; k++) {
                const w = s * (0.55 - k * 0.1), y = py - s * 0.22 * k * 1.6;
                x.beginPath(); x.moveTo(px - w, y); x.lineTo(px, y - s * 0.62); x.lineTo(px + w, y); x.closePath(); x.fill();
            }
            x.fillRect(px - s * 0.05, py, s * 0.1, s * 0.18);
        };
        const treeCol = mix(pal.near, pal.mid, 0.35);
        for (let i = 0; i < W / 22; i++) {
            const px = r() * W, n = Math.sin(px * 0.0065 + 3.2) * 0.55 + Math.sin(px * 0.0065 * 2.3 + 3.2 * 1.7) * 0.3 + Math.sin(px * 0.0065 * 5.1 + 3.2 * 0.4) * 0.15;
            const ridge = hy + H * 0.075 - H * 0.09 * (0.5 + 0.5 * n);
            pine(px, ridge + 4, H * (0.035 + r() * 0.03), treeCol);
        }
        layer(hy + H * 0.15, H * 0.1, 0.0034, 5.5, pal.near);
        const nearC = mix(pal.near, [0, 0, 0], 0.25);
        for (let i = 0; i < W / 70; i++) {
            const px = r() * W;
            pine(px, H * 0.99, H * (0.12 + r() * 0.1) * (px < W * 0.18 || px > W * 0.82 ? 1.25 : 0.7), nearC);
        }
        // snow cover speckle
        if (pal.snowAmt > 0.3) {
            x.fillStyle = rgba([255, 255, 255], 0.18 * pal.snowAmt);
            for (let i = 0; i < 160; i++) x.fillRect(r() * W, hy + r() * (H - hy), 2, 1);
        }
        return c;
    }

    /* ---------- (re)build ---------- */
    function build() {
        if (!P || !W) return;
        pal = derive(P);
        ground = buildGround();
        moonSprite = buildMoon(P.moonPhase);

        const r = rng(1234);
        sprites = [];
        for (let i = 0; i < 6; i++) {
            const wide = i >= 4;
            sprites.push(cloudSprite(wide ? 900 : 520, wide ? 230 : 240, 11 + i * 17, wide ? 70 : 38, pal.light, pal.dark));
        }
        clouds = [];
        const n = P.cover < 0.04 ? 0 : Math.round(2 + P.cover * 9);
        const heavy = P.cover > 0.75;
        for (let i = 0; i < n; i++) {
            const depth = r();                                   // 0 far .. 1 near
            const useWide = heavy ? r() < 0.55 : r() < 0.12;
            const sp = sprites[useWide ? 4 + (i % 2) : i % 4];
            const sc = (0.35 + depth * 0.75) * (useWide ? 1.2 : 1) * (W / 900 + 0.5) * 0.9;
            clouds.push({
                sp, depth, sc,
                x: r() * (W + sp.width * sc) - sp.width * sc * 0.5,
                y: H * (0.04 + (1 - depth) * 0.3 + r() * 0.1) - sp.height * sc * 0.25,
                v: (4 + P.wind * 0.9) * (0.4 + depth * 0.9),
                a: clamp(0.55 + P.cover * 0.5 - (1 - depth) * 0.1, 0.3, 1),
            });
        }
        clouds.sort((a, b) => a.depth - b.depth);

        stars = Array.from({ length: Math.round(W * H / 2600) }, () => ({
            x: r() * W, y: r() * horizonY() * 0.95, s: 0.4 + r() * 1.2, p: r() * 6.28, f: 0.6 + r() * 2,
        }));

        const area = W * H / 1e5;
        drops = Array.from({ length: Math.round(P.rain * area * 38) }, () => newDrop(true));
        flakes = Array.from({ length: Math.round(P.snow * area * 30) }, () => newFlake(true));
        splashes = [];
        fogBlobs = Array.from({ length: 9 }, (_, i) => ({
            x: r() * W, y: horizonY() - H * 0.1 + r() * H * 0.28, s: (0.5 + r()) * W * 0.5, v: (3 + r() * 6) * (i % 2 ? 1 : -1), a: 0.5 + r() * 0.5,
        }));
    }

    function newDrop(init) {
        const z = Math.random();
        return {
            x: Math.random() * (W + 200) - 100, y: init ? Math.random() * H : -20 - Math.random() * 100,
            z, len: 10 + z * 18, v: 520 + z * 620,
        };
    }
    function newFlake(init) {
        const z = Math.random();
        return { x: Math.random() * W, y: init ? Math.random() * H : -10, z, r: 0.8 + z * 2.6, v: 28 + z * 55, ph: Math.random() * 6.28 };
    }

    /* ---------- draw ---------- */
    function sunPos() {
        const p = P.sunP;
        return { x: W * (0.12 + 0.76 * p), y: horizonY() - Math.sin(Math.PI * p) * H * 0.5 - H * 0.01 };
    }
    function moonPos() {
        const q = P.moonP;
        return { x: W * (0.12 + 0.76 * q), y: horizonY() - Math.sin(Math.PI * q) * H * 0.48 - H * 0.04 };
    }

    function drawSky() {
        const hy = horizonY();
        const g = ctx.createLinearGradient(0, 0, 0, hy);
        g.addColorStop(0, rgba(pal.sky.top)); g.addColorStop(0.55, rgba(pal.sky.mid)); g.addColorStop(1, rgba(pal.sky.hor));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 2);
    }

    function drawStars(t) {
        const vis = clamp(pal.nightF * 1.6) * (1 - P.cover * 0.9) * (1 - P.fog * 0.8);
        if (vis < 0.02) return;
        for (const s of stars) {
            const a = vis * (0.45 + 0.55 * Math.sin(t * s.f + s.p));
            ctx.fillStyle = `rgba(235,240,255,${clamp(a)})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, 7); ctx.fill();
        }
        if (shooting) {
            const k = shooting.t / shooting.d;
            ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * vis})`; ctx.lineWidth = 1.5;
            const x = shooting.x + shooting.dx * k, y = shooting.y + shooting.dy * k;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - shooting.dx * 0.12, y - shooting.dy * 0.12); ctx.stroke();
        }
    }

    function drawSun(t) {
        const vis = (1 - P.cover * 0.82) * (1 - P.fog * 0.6) * clamp((pal.alt + 0.06) * 14);
        const { x, y } = sunPos();
        const hor = clamp(1 - pal.alt * 2.2);
        const sc = mix([255, 252, 238], [255, 140, 55], hor);
        const R = H * 0.05 * (1 + hor * 0.35);
        // wide atmospheric glow (also lights the horizon at sunrise / sunset)
        const glowA = (0.2 + 0.5 * pal.sunset) * (0.35 + vis * 0.65) * clamp((pal.alt + 0.25) * 6);
        let g = ctx.createRadialGradient(x, y, 0, x, y, H * 0.95);
        g.addColorStop(0, rgba(sc, glowA)); g.addColorStop(0.35, rgba(mix(sc, pal.sky.mid, 0.5), glowA * 0.35)); g.addColorStop(1, rgba(sc, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizonY() + 2);
        if (vis < 0.03) return;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        // rotating rays
        ctx.translate(x, y);
        const rays = 14;
        for (let i = 0; i < rays; i++) {
            const a = (i / rays) * 6.283 + t * 0.03;
            const w = 0.05 + 0.03 * Math.sin(i * 12.9 + t * 0.4);
            const rg = ctx.createRadialGradient(0, 0, R, 0, 0, H * 0.9);
            rg.addColorStop(0, rgba(sc, 0.07 * vis)); rg.addColorStop(1, rgba(sc, 0));
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, H * 0.9, a - w, a + w); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        g = ctx.createRadialGradient(x, y, 0, x, y, R * 4);
        g.addColorStop(0, rgba(sc, 0.85 * vis)); g.addColorStop(0.25, rgba(sc, 0.35 * vis)); g.addColorStop(1, rgba(sc, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 4, 0, 7); ctx.fill();
        g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R);
        g.addColorStop(0, `rgba(255,255,250,${vis})`); g.addColorStop(0.9, rgba(sc, vis)); g.addColorStop(1, rgba(sc, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
        // lens flare ghosts
        if (vis > 0.5 && pal.alt > 0.1) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            const cx = W / 2, cy = H * 0.45;
            [[0.35, 0.05], [0.6, 0.09], [1.0, 0.04], [1.5, 0.12]].forEach(([k, s], i) => {
                const fx = x + (cx - x) * k * 1.6, fy = y + (cy - y) * k * 1.6, fr = H * s;
                const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
                const col = i % 2 ? [150, 200, 255] : [255, 210, 150];
                fg.addColorStop(0, rgba(col, 0.1 * vis)); fg.addColorStop(0.8, rgba(col, 0.05 * vis)); fg.addColorStop(1, rgba(col, 0));
                ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, 7); ctx.fill();
            });
            ctx.restore();
        }
    }

    function drawMoon() {
        const vis = clamp(pal.nightF * 2.5) * (1 - P.cover * 0.8) * (1 - P.fog * 0.6);
        if (vis < 0.02) return;
        const { x, y } = moonPos(), R = H * 0.05;
        const g = ctx.createRadialGradient(x, y, R * 0.5, x, y, R * 7);
        g.addColorStop(0, `rgba(170,190,255,${0.28 * vis})`); g.addColorStop(1, 'rgba(170,190,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 7, 0, 7); ctx.fill();
        ctx.globalAlpha = vis;
        const s = R / 0.38 * 1;
        ctx.drawImage(moonSprite, x - s, y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
    }

    function drawClouds(dt) {
        for (const c of clouds) {
            const w = c.sp.width * c.sc, h = c.sp.height * c.sc;
            c.x += c.v * dt * (P.windSign || 1);
            if (c.x > W + 40) c.x = -w; else if (c.x < -w - 40) c.x = W;
            ctx.globalAlpha = c.a;
            ctx.drawImage(c.sp, c.x, c.y, w, h);
        }
        ctx.globalAlpha = 1;
        if (P.cover > 0.6) {          // overcast ceiling
            const a = clamp((P.cover - 0.6) * 1.6) * (P.storm ? 0.75 : 0.45);
            const g = ctx.createLinearGradient(0, 0, 0, horizonY());
            g.addColorStop(0, rgba(pal.dark, a)); g.addColorStop(0.7, rgba(pal.dark, a * 0.35)); g.addColorStop(1, rgba(pal.light, 0));
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizonY());
        }
    }

    function drawFog(dt, front) {
        if (P.fog < 0.02) return;
        const col = mix(pal.sky.hor, pal.nightF > 0.5 ? [40, 50, 75] : [235, 238, 242], 0.55);
        for (let i = 0; i < fogBlobs.length; i++) {
            if ((i % 2 === 0) !== front) continue;
            const b = fogBlobs[i];
            b.x += b.v * dt; if (b.x > W + b.s) b.x = -b.s; if (b.x < -b.s) b.x = W + b.s;
            const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.s);
            g.addColorStop(0, rgba(col, 0.55 * P.fog * b.a)); g.addColorStop(1, rgba(col, 0));
            ctx.save(); ctx.translate(0, b.y); ctx.scale(1, 0.38); ctx.translate(0, -b.y);
            ctx.fillStyle = g; ctx.fillRect(b.x - b.s, b.y - b.s, b.s * 2, b.s * 2); ctx.restore();
        }
        if (front) {
            const g = ctx.createLinearGradient(0, horizonY() - H * 0.25, 0, H);
            g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, 0.5 * P.fog)); g.addColorStop(1, rgba(col, 0.7 * P.fog));
            ctx.fillStyle = g; ctx.fillRect(0, horizonY() - H * 0.25, W, H);
            ctx.fillStyle = rgba(col, 0.28 * P.fog); ctx.fillRect(0, 0, W, H);
        }
    }

    function drawRain(dt) {
        if (!drops.length) return;
        const slant = clamp(P.wind / 55) * 0.55 * (P.windSign || 1) + 0.04 * (P.windSign || 1);
        const lightCol = pal.nightF > 0.5 ? [150, 170, 215] : [205, 220, 240];
        ctx.lineCap = 'round';
        const gy = horizonY() + H * 0.09;
        for (const d of drops) {
            d.y += d.v * dt; d.x += d.v * dt * slant;
            const floor = gy + d.z * (H - gy) * 0.95;
            if (d.y > floor) {
                if (splashes.length < 90 && d.z > 0.3) splashes.push({ x: d.x, y: floor, t: 0, z: d.z });
                Object.assign(d, newDrop(false)); d.x = Math.random() * (W + 200) - 100 - H * slant * 0.5;
            }
            ctx.strokeStyle = rgba(lightCol, 0.18 + d.z * 0.4);
            ctx.lineWidth = 0.6 + d.z * 1.1;
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * slant * 1.3, d.y - d.len); ctx.stroke();
        }
        for (let i = splashes.length - 1; i >= 0; i--) {
            const s = splashes[i]; s.t += dt;
            if (s.t > 0.45) { splashes.splice(i, 1); continue; }
            const k = s.t / 0.45;
            ctx.strokeStyle = rgba(lightCol, (1 - k) * 0.4 * s.z); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.ellipse(s.x, s.y, 2 + k * 9 * s.z, (2 + k * 9 * s.z) * 0.3, 0, 0, 7); ctx.stroke();
        }
    }

    function drawSnow(dt, t) {
        const sway = (P.windSign || 1) * clamp(P.wind / 30);
        const col = pal.nightF > 0.6 ? [215, 225, 250] : [255, 255, 255];
        for (const f of flakes) {
            f.y += f.v * dt; f.x += (Math.sin(t * 0.8 + f.ph) * 14 + sway * 40) * dt;
            if (f.y > H + 5) Object.assign(f, newFlake(false));
            if (f.x > W + 10) f.x = -10; if (f.x < -10) f.x = W + 10;
            ctx.fillStyle = rgba(col, 0.35 + f.z * 0.6);
            ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
        }
    }

    function drawLightning(dt) {
        if (!P.storm) return;
        nextBolt -= dt;
        if (nextBolt <= 0) {
            nextBolt = 3 + Math.random() * 7; flash = 1;
            let x = W * (0.15 + Math.random() * 0.7), y = H * 0.1;
            const pts = [[x, y]];
            while (y < horizonY() + H * 0.05) { x += (Math.random() - 0.5) * 50; y += 18 + Math.random() * 26; pts.push([x, y]); }
            bolt = { pts, life: 1 };
        }
        if (flash > 0) {
            ctx.fillStyle = `rgba(210,225,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H);
            flash = Math.max(0, flash - dt * 3.2);
        }
        if (bolt) {
            bolt.life -= dt * 4;
            if (bolt.life <= 0) bolt = null;
            else {
                const a = bolt.life > 0.6 ? 1 : bolt.life / 0.6 * (Math.random() > 0.3 ? 1 : 0.3);
                ctx.save(); ctx.lineJoin = 'round';
                ctx.strokeStyle = `rgba(160,190,255,${a * 0.35})`; ctx.lineWidth = 9; ctx.shadowColor = '#9fc0ff'; ctx.shadowBlur = 24;
                ctx.beginPath(); bolt.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
                ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2.2; ctx.shadowBlur = 8; ctx.stroke();
                ctx.restore();
            }
        }
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        if (!ctx || !P || !W) return;
        let dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
        if (reduced) dt *= 0.15;
        const t = now / 1000;

        if (pal.nightF > 0.5 && P.cover < 0.4) {
            nextShoot -= dt;
            if (nextShoot <= 0 && !shooting) { nextShoot = 8 + Math.random() * 14; shooting = { x: Math.random() * W * 0.7, y: Math.random() * H * 0.25, dx: 220, dy: 90, t: 0, d: 0.9 }; }
            if (shooting && (shooting.t += dt) > shooting.d) shooting = null;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawSky(); drawStars(t); drawSun(t); drawMoon(); drawClouds(dt); drawFog(dt, false);
        ctx.drawImage(ground, 0, 0, W, H);
        drawFog(dt, true); drawRain(dt); drawSnow(dt, t); drawLightning(dt);
        // vignette
        const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }

    function resize() {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = Math.round(r.width); H = Math.round(r.height);
        canvas.width = W * dpr; canvas.height = H * dpr;
        build();
    }

    return {
        init(el) {
            canvas = el; ctx = el.getContext('2d');
            new ResizeObserver(resize).observe(el);
            resize();
            raf = requestAnimationFrame(frame);
        },
        /** p: {alt, sunP, moonP, moonPhase, cover, rain, snow, fog, storm, wind, windSign} → returns palette */
        set(p) {
            P = p; build();
            canvas.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' });
            return pal;
        },
    };
})();
