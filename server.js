// server.js — GGBrainX API (Render-ready) + Live Drops + Luck Boost + Topup Race

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = '/tmp';
const PROMO_FILE = path.join(DATA_DIR, 'promocodes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEPOSITS_FILE = path.join(DATA_DIR, 'deposits.json');
const LIVE_DROPS_FILE = path.join(DATA_DIR, 'live_drops.json');
const USER_DROPS_FILE = path.join(DATA_DIR, 'user_drops.json');
const LUCK_FILE = path.join(DATA_DIR, 'luck.json');
const TOPUP_RACE_FILE = path.join(DATA_DIR, 'topup_race.json');

const ADMIN_USERNAME = 'clonexx7';

let promocodes = {};
let users = {};
let deposits = [];
let liveDrops = [];
let userDrops = {};
let luckState = { multiplier: 1, until: 0, by: '', ts: 0 };
// topupRace: { id, itemId, minTopup, endsAt, createdAt, by, participants: { [tgId]: { username, total, updatedAt } }, winner: null|{ tgId, username, total } }
let topupRace = null;

function ensureDataDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
function loadJSON(file, fallback) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { console.error('[ERROR] Load', file, err.message); }
    return fallback;
}
function saveJSON(file, data) {
    try { ensureDataDir(); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
    catch (err) { console.error('[ERROR] Save', file, err.message); }
}

function loadAll() {
    promocodes = loadJSON(PROMO_FILE, {});
    users = loadJSON(USERS_FILE, {});
    deposits = loadJSON(DEPOSITS_FILE, []);
    liveDrops = loadJSON(LIVE_DROPS_FILE, []);
    userDrops = loadJSON(USER_DROPS_FILE, {});
    luckState = loadJSON(LUCK_FILE, { multiplier: 1, until: 0, by: '', ts: 0 });
    topupRace = loadJSON(TOPUP_RACE_FILE, null);

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    liveDrops = liveDrops.filter(d => d.ts > cutoff).slice(0, 200);

    const cutoff90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
    Object.keys(userDrops).forEach(id => {
        userDrops[id] = userDrops[id].filter(d => d.ts > cutoff90).slice(0, 500);
    });

    if (luckState.until && luckState.until < Date.now()) {
        luckState = { multiplier: 1, until: 0, by: '', ts: Date.now() };
        saveJSON(LUCK_FILE, luckState);
    }

    console.log('[OK] Промокодов:', Object.keys(promocodes).length,
                '| Юзеров:', Object.keys(users).length,
                '| Live-дропов:', liveDrops.length,
                '| Luck:', luckState.multiplier + 'x',
                '| Розыгрыш:', topupRace ? topupRace.itemId : 'нет');
}

function savePromos() { saveJSON(PROMO_FILE, promocodes); }
function saveUsers() { saveJSON(USERS_FILE, users); }
function saveDeposits() { saveJSON(DEPOSITS_FILE, deposits); }
function saveLiveDrops() { saveJSON(LIVE_DROPS_FILE, liveDrops); }
function saveUserDrops() { saveJSON(USER_DROPS_FILE, userDrops); }
function saveLuck() { saveJSON(LUCK_FILE, luckState); }
function saveTopupRace() { saveJSON(TOPUP_RACE_FILE, topupRace); }

function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJSON(res, status, data) {
    setCORS(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (err) { reject(new Error('Неверный JSON')); }
        });
        req.on('error', reject);
    });
}

function ensureUser(telegramId, username) {
    if (!telegramId) telegramId = 'guest_' + Date.now();
    if (!users[telegramId]) {
        users[telegramId] = {
            balance: 0, inventory: [], username: username || '',
            roblox_name: '', custom_nick: '', avatar: '', accent: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    } else if (username && users[telegramId].username !== username) {
        users[telegramId].username = username;
        users[telegramId].updated_at = new Date().toISOString();
    }
    return users[telegramId];
}

function addTopupParticipant(telegramId, username, amount) {
    if (!topupRace || !topupRace.id) return;
    if (topupRace.endsAt && topupRace.endsAt < Date.now()) return; // розыгрыш уже закончился
    if (amount < (topupRace.minTopup || 0)) return;
    if (!topupRace.participants) topupRace.participants = {};
    const key = telegramId || ('guest_' + Date.now());
    if (!topupRace.participants[key]) {
        topupRace.participants[key] = { username: username || 'guest', total: 0, updatedAt: Date.now() };
    }
    topupRace.participants[key].username = username || topupRace.participants[key].username;
    topupRace.participants[key].total += Number(amount) || 0;
    topupRace.participants[key].updatedAt = Date.now();
    saveTopupRace();
}

function getTopupRaceWithTop(limit = 15) {
    if (!topupRace) return null;
    const participants = Object.entries(topupRace.participants || {})
        .map(([tgId, v]) => ({ tgId, username: v.username, total: v.total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
    const ended = topupRace.endsAt && topupRace.endsAt < Date.now();
    return {
        id: topupRace.id,
        itemId: topupRace.itemId,
        minTopup: topupRace.minTopup,
        endsAt: topupRace.endsAt,
        createdAt: topupRace.createdAt,
        by: topupRace.by,
        ended,
        winner: topupRace.winner || (ended && participants[0]) || null,
        top: participants
    };
}

function cleanup() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const before = liveDrops.length;
    liveDrops = liveDrops.filter(d => d.ts > cutoff);
    if (liveDrops.length !== before) saveLiveDrops();

    if (luckState.until && luckState.until < Date.now()) {
        luckState = { multiplier: 1, until: 0, by: '', ts: Date.now() };
        saveLuck();
    }

    // фиксируем победителя розыгрыша при истечении
    if (topupRace && topupRace.endsAt && topupRace.endsAt < Date.now() && !topupRace.winner) {
        const sorted = Object.entries(topupRace.participants || {})
            .map(([tgId, v]) => ({ tgId, username: v.username, total: v.total }))
            .sort((a, b) => b.total - a.total);
        if (sorted[0]) {
            topupRace.winner = sorted[0];
            saveTopupRace();
        }
    }
}
setInterval(cleanup, 60 * 1000);

const server = http.createServer(async (req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        setCORS(res);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GGBrainX server is alive');
        return;
    }

    try {
        // PROMOS
        if (req.method === 'GET' && req.url === '/api/promocodes') {
            sendJSON(res, 200, { ok: true, promocodes });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/create') {
            const body = await readBody(req);
            const { code, uses, type, value } = body;
            if (!code || typeof code !== 'string' || code.trim().length < 3)
                return sendJSON(res, 400, { ok: false, error: 'Название минимум 3 символа' });
            if (!uses || uses < 1)
                return sendJSON(res, 400, { ok: false, error: 'Активаций минимум 1' });
            if (type !== 'balance' && type !== 'item')
                return sendJSON(res, 400, { ok: false, error: 'Тип balance|item' });

            const upperCode = code.trim().toUpperCase();
            if (promocodes[upperCode])
                return sendJSON(res, 409, { ok: false, error: 'Промокод уже есть' });

            promocodes[upperCode] = {
                code: upperCode, uses: parseInt(uses), type,
                value: type === 'balance' ? parseInt(value) : value,
                createdAt: new Date().toISOString()
            };
            savePromos();
            sendJSON(res, 200, { ok: true, promo: promocodes[upperCode] });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/activate') {
            const body = await readBody(req);
            const { code, telegram_id } = body;
            if (!code) return sendJSON(res, 400, { ok: false, error: 'Введите промокод' });

            const upperCode = code.trim().toUpperCase();
            const promo = promocodes[upperCode];
            if (!promo) return sendJSON(res, 404, { ok: false, error: 'Промокод не найден' });
            if (promo.uses <= 0) return sendJSON(res, 410, { ok: false, error: 'Промокод больше не активен' });

            promo.uses -= 1;
            savePromos();

            if (telegram_id && promo.type === 'balance') {
                const u = ensureUser(telegram_id);
                u.balance = (u.balance || 0) + promo.value;
                u.updated_at = new Date().toISOString();
                saveUsers();
            } else if (telegram_id && promo.type === 'item') {
                const u = ensureUser(telegram_id);
                if (!Array.isArray(u.inventory)) u.inventory = [];
                u.inventory.push(promo.value);
                u.updated_at = new Date().toISOString();
                saveUsers();
            }
            sendJSON(res, 200, { ok: true, type: promo.type, value: promo.value, remaining: promo.uses });
            return;
        }

        // USER
        if (req.method === 'GET' && req.url.startsWith('/api/user/')) {
            const id = decodeURIComponent(req.url.slice('/api/user/'.length));
            const u = ensureUser(id);
            saveUsers();
            sendJSON(res, 200, { ok: true, user: u });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/user/update') {
            const body = await readBody(req);
            const { telegram_id, balance, inventory, roblox_name, custom_nick, avatar, username, accent } = body;
            if (!telegram_id) return sendJSON(res, 400, { ok: false, error: 'telegram_id обязателен' });

            const u = ensureUser(telegram_id, username);
            if (typeof balance === 'number' && !isNaN(balance)) u.balance = balance;
            if (Array.isArray(inventory)) u.inventory = inventory;
            if (typeof roblox_name === 'string') u.roblox_name = roblox_name;
            if (typeof custom_nick === 'string') u.custom_nick = custom_nick;
            if (typeof avatar === 'string') u.avatar = avatar;
            if (typeof accent === 'string') u.accent = accent;
            u.updated_at = new Date().toISOString();
            saveUsers();
            sendJSON(res, 200, { ok: true, user: u });
            return;
        }

        // DEPOSITS
        if (req.method === 'POST' && req.url === '/api/deposit/create') {
            const body = await readBody(req);
            const { telegram_id, username, item_id, item_name, item_price, roblox_name } = body;
            if (!telegram_id) return sendJSON(res, 400, { ok: false, error: 'telegram_id обязателен' });
            if (!item_id) return sendJSON(res, 400, { ok: false, error: 'Не выбран предмет' });
            if (!roblox_name || !roblox_name.trim()) return sendJSON(res, 400, { ok: false, error: 'Введите Roblox ник' });

            const u = ensureUser(telegram_id, username);
            u.roblox_name = roblox_name.trim();
            saveUsers();

            const deposit = {
                id: 'dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                telegram_id,
                username: username || u.username || '',
                item_id, item_name: item_name || '',
                item_price: Number(item_price) || 0,
                roblox_name: roblox_name.trim(),
                status: 'pending', created_at: new Date().toISOString()
            };
            deposits.push(deposit);
            saveDeposits();
            sendJSON(res, 200, { ok: true, deposit });
            return;
        }
        if (req.method === 'GET' && req.url === '/api/deposits') {
            sendJSON(res, 200, { ok: true, deposits });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/deposit/status') {
            const body = await readBody(req);
            const { id, status, admin } = body;
            if (!id) return sendJSON(res, 400, { ok: false, error: 'id обязателен' });
            if (!['accepted', 'rejected'].includes(status))
                return sendJSON(res, 400, { ok: false, error: 'status accepted|rejected' });

            const dep = deposits.find(d => d.id === id);
            if (!dep) return sendJSON(res, 404, { ok: false, error: 'Заявка не найдена' });

            dep.status = status;
            dep.processed_at = new Date().toISOString();
            dep.processed_by = admin || '';

            if (status === 'accepted') {
                const u = ensureUser(dep.telegram_id);
                u.balance = (u.balance || 0) + (Number(dep.item_price) || 0);
                u.updated_at = new Date().toISOString();
                saveUsers();
                // добавляем в топ пополнений активного розыгрыша
                addTopupParticipant(dep.telegram_id, dep.username, Number(dep.item_price) || 0);
            }
            saveDeposits();
            sendJSON(res, 200, { ok: true, deposit: dep });
            return;
        }

        // LIVE DROPS
        if (req.method === 'POST' && req.url === '/api/live-drop') {
            const body = await readBody(req);
            const { telegram_id, username, item_id } = body;
            if (!item_id) return sendJSON(res, 400, { ok: false, error: 'item_id обязателен' });

            const entry = {
                telegram_id: telegram_id || '',
                username: username || 'guest',
                item_id, ts: Date.now()
            };
            liveDrops.unshift(entry);
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            liveDrops = liveDrops.filter(d => d.ts > cutoff).slice(0, 200);
            saveLiveDrops();

            if (telegram_id) {
                if (!userDrops[telegram_id]) userDrops[telegram_id] = [];
                userDrops[telegram_id].unshift({ item_id, ts: Date.now() });
                userDrops[telegram_id] = userDrops[telegram_id].slice(0, 500);
                saveUserDrops();
            }
            sendJSON(res, 200, { ok: true, entry });
            return;
        }
        if (req.method === 'GET' && req.url === '/api/live-drops') {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const recent = liveDrops.filter(d => d.ts > cutoff);
            sendJSON(res, 200, { ok: true, drops: recent });
            return;
        }
        if (req.method === 'GET' && req.url.startsWith('/api/user-drops/')) {
            const id = decodeURIComponent(req.url.slice('/api/user-drops/'.length));
            const drops = userDrops[id] || [];
            sendJSON(res, 200, { ok: true, drops });
            return;
        }

        // ===== LUCK BOOST =====
        if (req.method === 'GET' && req.url === '/api/luck') {
            const now = Date.now();
            const active = luckState.until > now;
            sendJSON(res, 200, {
                ok: true,
                luck: active ? luckState : { multiplier: 1, until: 0, by: '', ts: luckState.ts },
                active
            });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/luck') {
            const body = await readBody(req);
            const { admin, multiplier, durationMs } = body;
            if (!admin || admin.toLowerCase() !== ADMIN_USERNAME)
                return sendJSON(res, 403, { ok: false, error: 'Нет доступа' });

            const mult = Number(multiplier);
            if (![1, 4, 6].includes(mult))
                return sendJSON(res, 400, { ok: false, error: 'multiplier 1|4|6' });

            const dur = Math.max(0, Number(durationMs) || 0);
            if (mult === 1) {
                luckState = { multiplier: 1, until: 0, by: admin, ts: Date.now() };
            } else {
                luckState = {
                    multiplier: mult,
                    until: Date.now() + dur,
                    by: admin,
                    ts: Date.now()
                };
            }
            saveLuck();
            console.log('[LUCK]', admin, '→', mult + 'x', 'на', Math.round(dur / 60000) + 'мин');
            sendJSON(res, 200, { ok: true, luck: luckState });
            return;
        }

        // ===== TOPUP RACE =====
        if (req.method === 'GET' && req.url === '/api/topup-race') {
            sendJSON(res, 200, { ok: true, race: getTopupRaceWithTop(15) });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/topup-race/set') {
            const body = await readBody(req);
            const { admin, itemId, minTopup, days } = body;
            if (!admin || admin.toLowerCase() !== ADMIN_USERNAME)
                return sendJSON(res, 403, { ok: false, error: 'Нет доступа' });
            if (!itemId) return sendJSON(res, 400, { ok: false, error: 'itemId обязателен' });
            const min = Math.max(1, Number(minTopup) || 1);
            const d = Math.max(1, Number(days) || 1);
            topupRace = {
                id: 'race_' + Date.now(),
                itemId,
                minTopup: min,
                endsAt: Date.now() + d * 24 * 60 * 60 * 1000,
                createdAt: Date.now(),
                by: admin,
                participants: {},
                winner: null
            };
            saveTopupRace();
            console.log('[TOPUP RACE] Новый:', itemId, '| мин', min, '|', d, 'дн.');
            sendJSON(res, 200, { ok: true, race: getTopupRaceWithTop(15) });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/topup-race/add') {
            const body = await readBody(req);
            const { telegram_id, username, amount } = body;
            if (!telegram_id || !amount) return sendJSON(res, 400, { ok: false, error: 'telegram_id и amount обязательны' });
            addTopupParticipant(telegram_id, username, amount);
            sendJSON(res, 200, { ok: true, race: getTopupRaceWithTop(15) });
            return;
        }

        sendJSON(res, 404, { ok: false, error: 'Метод не найден: ' + req.method + ' ' + req.url });

    } catch (err) {
        console.error('[ERROR]', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
    }
});

loadAll();

server.listen(PORT, () => {
    console.log('=========================================');
    console.log('  GGBrainX server запущен, порт ' + PORT);
    console.log('=========================================');
});

server.on('error', (err) => {
    console.error('[ERROR] Сервер не смог запуститься:', err.message);
    if (err.code === 'EADDRINUSE') console.error('Порт ' + PORT + ' уже занят.');
});
