/* Sole Mio — data, UI wiring (Open-Meteo, no API key) */
const $ = id => document.getElementById(id);
const DEFAULT_PLACE = { name: 'Roma', country: 'Italia', latitude: 41.8919, longitude: 12.5113 };

const state = { place: null, data: null, selected: -1, baseMs: 0, basePerf: 0 };

/* ---------- weather code helpers ---------- */
function describe(code) {
    if (code === 0) return 'Sereno';
    if (code === 1) return 'Prevalentemente sereno';
    if (code === 2) return 'Parzialmente nuvoloso';
    if (code === 3) return 'Coperto';
    if (code <= 48) return 'Nebbia';
    if (code <= 55) return 'Pioggerella';
    if (code <= 57) return 'Pioggerella gelata';
    if (code <= 63) return 'Pioggia';
    if (code === 65) return 'Pioggia intensa';
    if (code <= 67) return 'Pioggia gelata';
    if (code <= 75) return 'Neve';
    if (code === 77) return 'Granelli di neve';
    if (code <= 81) return 'Rovesci';
    if (code === 82) return 'Rovesci violenti';
    if (code <= 86) return 'Rovesci di neve';
    return 'Temporale';
}

// → scene ingredients derived from a WMO weather code
function ingredients(code, apiCover) {
    let cover = 0.03, rain = 0, snow = 0, fog = 0, storm = false;
    if (code === 1) cover = 0.18;
    else if (code === 2) cover = 0.5;
    else if (code === 3) cover = 0.92;
    else if (code === 45 || code === 48) { cover = 0.8; fog = code === 48 ? 1 : 0.85; }
    else if (code >= 51 && code <= 57) { cover = 0.9; rain = 0.22; }
    else if (code === 61 || code === 80) { cover = 0.92; rain = 0.45; }
    else if (code === 63 || code === 81 || code === 66) { cover = 0.95; rain = 0.7; }
    else if (code === 65 || code === 82 || code === 67) { cover = 1; rain = 1; }
    else if (code === 71 || code === 77) { cover = 0.9; snow = 0.3; }
    else if (code === 73 || code === 85) { cover = 0.95; snow = 0.6; }
    else if (code === 75 || code === 86) { cover = 1; snow = 1; }
    else if (code >= 95) { cover = 1; rain = 0.9; storm = true; }
    if (code <= 3 && apiCover != null) cover = Math.max(cover * 0.5, apiCover / 100);
    return { cover, rain, snow, fog, storm };
}

function icon(code, night = false) {
    const sun = '<circle cx="24" cy="24" r="8" fill="#ffd54a"/><g stroke="#ffd54a" stroke-width="2.6" stroke-linecap="round"><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/></g>';
    const moon = '<path d="M31 8a16 16 0 1 0 9 28A14 14 0 0 1 31 8z" fill="#dfe6ff"/>';
    const cloud = (f = '#e9eef7', dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy})"><path d="M14 36a8 8 0 0 1-.6-16A11 11 0 0 1 34.6 17 9.5 9.5 0 0 1 35 36z" fill="${f}"/></g>`;
    const drops = '<g stroke="#6cb6ff" stroke-width="2.6" stroke-linecap="round"><path d="M17 40l-2 5M25 40l-2 5M33 40l-2 5"/></g>';
    const flakes = '<g fill="#fff"><circle cx="16" cy="43" r="1.8"/><circle cx="25" cy="42" r="1.8"/><circle cx="34" cy="43" r="1.8"/></g>';
    const bolt = '<path d="M26 32l-6 9h5l-2 7 8-10h-5z" fill="#ffd54a"/>';
    const fogL = '<g stroke="#cdd6e4" stroke-width="3" stroke-linecap="round"><path d="M10 22h28M6 30h30M12 38h28"/></g>';
    let body;
    if (code === 0 || code === 1) body = night ? moon : sun;
    else if (code === 2) body = (night ? moon : sun).replace('<', '<g transform="translate(-6 -6) scale(.8)"><') .replace(/$/, '</g>') + cloud('#e9eef7', 2, 2);
    else if (code === 3) body = cloud('#b9c3d3', 0, -2) + cloud('#e9eef7', 2, 3);
    else if (code <= 48) body = fogL;
    else if (code <= 67 || (code >= 80 && code <= 82)) body = cloud('#c4cddc', 0, -4) + drops;
    else if (code <= 77 || code === 85 || code === 86) body = cloud('#d5dcea', 0, -4) + flakes;
    else body = cloud('#8f9bb0', 0, -6) + bolt;
    return `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
}

const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = d => dirs[Math.round(d / 22.5) % 16];
const ms = s => Date.parse(s + 'Z');          // API gives local wall-clock time; treat uniformly as UTC
const hhmm = s => s ? s.slice(11, 16) : '--:--';

/* ---------- fetch ---------- */
async function load(place) {
    state.place = place;
    $('city').textContent = place.name;
    $('country').textContent = [place.admin1, place.country].filter(Boolean).join(', ');
    document.body.classList.add('loading');
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude + '&longitude=' + place.longitude +
            '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset' +
            '&hourly=precipitation_probability&timezone=auto&forecast_days=6&wind_speed_unit=kmh';
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.status);
        state.data = await r.json();
        state.selected = -1;
        state.baseMs = ms(state.data.current.time);
        state.basePerf = performance.now();
        try { localStorage.setItem('solemio.place', JSON.stringify(place)); } catch (e) { }
        render();
        $('error').hidden = true;
    } catch (e) {
        console.error(e);
        $('error').hidden = false;
    } finally {
        document.body.classList.remove('loading');
    }
}

/* ---------- render ---------- */
function moonPhase(t) {
    const days = (t - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    return ((days / 29.530588) % 1 + 1) % 1;
}

function sceneParams(sel) {
    const d = state.data, c = d.current;
    const idx = sel < 0 ? 0 : sel;
    const now = sel < 0 ? ms(c.time) : ms(d.daily.time[idx] + 'T13:00');
    const sr = ms(d.daily.sunrise[idx] || d.daily.time[idx] + 'T06:30');
    const ss = ms(d.daily.sunset[idx] || d.daily.time[idx] + 'T18:30');
    const nextSr = d.daily.sunrise[idx + 1] ? ms(d.daily.sunrise[idx + 1]) : sr + 86400000;
    let sunP = 0, moonP = 0.5, alt;
    if (now >= sr && now <= ss) {
        sunP = (now - sr) / (ss - sr);
        alt = Math.sin(Math.PI * sunP);
        moonP = 0.5;
    } else {
        const start = now > ss ? ss : ss - 86400000, end = now > ss ? nextSr : sr;
        moonP = clamp01((now - start) / (end - start));
        sunP = now > ss ? 1 : 0;
        alt = -Math.min(1, Math.sin(Math.PI * moonP) * 2.5);
    }
    const code = sel < 0 ? c.weather_code : d.daily.weather_code[idx];
    const wind = sel < 0 ? c.wind_speed_10m : d.daily.wind_speed_10m_max[idx];
    const dir = sel < 0 ? c.wind_direction_10m : 270;
    return {
        alt, sunP, moonP, moonPhase: moonPhase(now),
        ...ingredients(code, sel < 0 ? c.cloud_cover : null),
        wind, windSign: -Math.sign(Math.sin(dir * Math.PI / 180)) || 1,
    };
}
const clamp01 = x => Math.min(1, Math.max(0, x));

function render() {
    const d = state.data, c = d.current, day = d.daily, sel = state.selected;
    const show = sel < 0 ? 0 : sel;

    // scene + page tint
    const pal = Scene.set(sceneParams(sel));
    const css = (col, a = 1) => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;
    document.documentElement.style.setProperty('--tint-a', css(pal.sky.mid, 0.55));
    document.documentElement.style.setProperty('--tint-b', css(pal.sky.hor, 0.35));

    // hero
    const code = sel < 0 ? c.weather_code : day.weather_code[show];
    $('temp').textContent = sel < 0 ? Math.round(c.temperature_2m) : Math.round(day.temperature_2m_max[show]);
    $('desc').textContent = describe(code);
    $('modeChip').textContent = sel < 0 ? 'Adesso' : new Date(day.time[show] + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('backNow').hidden = sel < 0;
    $('hiLo').textContent = `Max ${Math.round(day.temperature_2m_max[show])}°  ·  Min ${Math.round(day.temperature_2m_min[show])}°`;

    // stats
    const hour = Math.min(23, +c.time.slice(11, 13));
    const prob = sel < 0 ? d.hourly.precipitation_probability[hour] : day.precipitation_probability_max[show];
    const mm = sel < 0 ? c.precipitation : day.precipitation_sum[show];
    const wind = sel < 0 ? c.wind_speed_10m : day.wind_speed_10m_max[show];
    $('sFeels').textContent = sel < 0 ? Math.round(c.apparent_temperature) + '°' : Math.round((day.temperature_2m_max[show] + day.temperature_2m_min[show]) / 2) + '°';
    $('sFeelsLbl').textContent = sel < 0 ? 'Percepita' : 'Media';
    $('sWind').textContent = Math.round(wind);
    $('sWindDir').textContent = sel < 0 ? compass(c.wind_direction_10m) : 'max';
    $('windArrow').style.transform = sel < 0 ? `rotate(${c.wind_direction_10m + 180}deg)` : 'rotate(0deg)';
    $('windArrow').style.opacity = sel < 0 ? 1 : 0.2;
    $('sRain').textContent = (prob ?? 0) + '%';
    $('sRainMm').textContent = (mm ?? 0).toFixed(1) + ' mm';
    $('sHum').textContent = sel < 0 ? Math.round(c.relative_humidity_2m) + '%' : '—';
    $('sRise').textContent = hhmm(day.sunrise[show]);
    $('sSet').textContent = hhmm(day.sunset[show]);

    // 5-day list (tomorrow → +5)
    const lo = Math.min(...day.temperature_2m_min.slice(1)), hi = Math.max(...day.temperature_2m_max.slice(1));
    $('days').innerHTML = [1, 2, 3, 4, 5].map(i => {
        const mn = day.temperature_2m_min[i], mx = day.temperature_2m_max[i];
        const l = ((mn - lo) / (hi - lo || 1)) * 100, w = Math.max(8, ((mx - mn) / (hi - lo || 1)) * 100);
        const dt = new Date(day.time[i] + 'T12:00');
        return `<li><button class="day${sel === i ? ' active' : ''}" data-i="${i}" aria-pressed="${sel === i}">
            <div class="d-name"><b>${dt.toLocaleDateString('it-IT', { weekday: 'long' })}</b><span>${dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</span></div>
            <div class="d-ico">${icon(day.weather_code[i])}</div>
            <div class="d-mid"><span class="d-desc">${describe(day.weather_code[i])}</span>
                <span class="d-meta"><svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>${day.precipitation_probability_max[i] ?? 0}%<svg viewBox="0 0 24 24"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3"/></svg>${Math.round(day.wind_speed_10m_max[i])} km/h</span></div>
            <div class="d-temp"><span class="lo">${Math.round(mn)}°</span>
                <span class="bar"><span style="left:${l}%;width:${w}%"></span></span>
                <span class="hi">${Math.round(mx)}°</span></div>
        </button></li>`;
    }).join('');
    tickClock();
}

function tickClock() {
    if (!state.data) return;
    const t = new Date(state.baseMs + (performance.now() - state.basePerf));
    $('clock').textContent = t.toISOString().slice(11, 16);
    $('date').textContent = t.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/* ---------- search ---------- */
let searchTimer, searchSeq = 0;
function suggestions(list) {
    const box = $('suggest');
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = list.map((p, i) => `<li role="option" data-i="${i}"><b>${p.name}</b><span>${[p.admin1, p.country].filter(Boolean).join(', ')}</span></li>`).join('');
    box.hidden = false;
    box._list = list;
}
$('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { suggestions([]); return; }
    searchTimer = setTimeout(async () => {
        const seq = ++searchSeq;
        try {
            const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=it&format=json`);
            const j = await r.json();
            if (seq === searchSeq) suggestions(j.results || []);
        } catch (e) { /* offline: ignore */ }
    }, 250);
});
$('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const l = $('suggest')._list; if (l && l[0] && !$('suggest').hidden) pick(l[0]); }
    if (e.key === 'Escape') $('suggest').hidden = true;
});
$('suggest').addEventListener('click', e => {
    const li = e.target.closest('li'); if (li) pick($('suggest')._list[+li.dataset.i]);
});
document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) $('suggest').hidden = true; });
function pick(p) { $('suggest').hidden = true; $('search').value = ''; $('search').blur(); load(p); }

$('locate').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('locate').classList.add('busy');
    navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude, longitude } = pos.coords;
        let place = { name: 'La tua posizione', latitude, longitude };
        try {
            const r = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=it`);
            const j = await r.json();
            if (j.results && j.results[0]) place = { ...j.results[0], latitude, longitude };
        } catch (e) { }
        $('locate').classList.remove('busy');
        load(place);
    }, () => { $('locate').classList.remove('busy'); alert('Impossibile ottenere la posizione. Controlla i permessi del browser.'); },
        { timeout: 10000 });
});

$('days').addEventListener('click', e => {
    const b = e.target.closest('.day'); if (!b) return;
    const i = +b.dataset.i;
    state.selected = state.selected === i ? -1 : i;
    render();
});
$('backNow').addEventListener('click', () => { state.selected = -1; render(); });

/* ---------- boot ---------- */
Scene.init($('scene'));
let saved = null;
try { saved = JSON.parse(localStorage.getItem('solemio.place')); } catch (e) { }
load(saved || DEFAULT_PLACE);
setInterval(tickClock, 15000);
setInterval(() => { if (state.place && state.selected < 0) load(state.place); }, 10 * 60 * 1000);
