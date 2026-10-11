// server.js — GGBrainX API (Render-ready)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = '/tmp';
const PROMO_FILE = path.join(DATA_DIR, 'promocodes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEPOSITS_FILE = path.join(DATA_DIR, 'deposits.json');

// ===== Хранилище =====
let promocodes = {};
let users = {};        // { telegram_id: { balance, inventory: [], username, roblox_name } }
let deposits = [];     // [ { id, telegram_id, username, item_id, item_name, item_price, roblox_name, status, created_at } ]

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {}
}

function loadJSON(file, fallback) {
    try {
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.error('[ERROR] Load', file, err.message);
    }
    return fallback;
}

function saveJSON(file, data) {
    try {
        ensureDataDir();
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('[ERROR] Save', file, err.message);
    }
}

function loadAll() {
    promocodes = loadJSON(PROMO_FILE, {});
    users = loadJSON(USERS_FILE, {});
    deposits = loadJSON(DEPOSITS_FILE, []);
    console.log('[OK] Промокодов:', Object.keys(promocodes).length,
                '| Юзеров:', Object.keys(users).length,
                '| Заявок:', deposits.length);
}

function savePromos() { saveJSON(PROMO_FILE, promocodes); }
function saveUsers() { saveJSON(USERS_FILE, users); }
function saveDeposits() { saveJSON(DEPOSITS_FILE, deposits); }

// ===== CORS =====
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

// ===== Работа с юзером =====
function ensureUser(telegramId, username) {
    if (!telegramId) telegramId = 'guest_' + Date.now();
    if (!users[telegramId]) {
        users[telegramId] = {
            balance: 0,
            inventory: [],
            username: username || '',
            roblox_name: '',
            created_at: new Date().toISOString()
        };
    } else if (username && users[telegramId].username !== username) {
        users[telegramId].username = username;
    }
    return users[telegramId];
}

// ===== Сервер =====
const server = http.createServer(async (req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
        setCORS(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // ---- HEALTH-CHECK ----
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        setCORS(res);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GGBrainX server is alive');
        return;
    }

    try {
        // ---- GET /api/promocodes ----
        if (req.method === 'GET' && req.url === '/api/promocodes') {
            sendJSON(res, 200, { ok: true, promocodes });
            return;
        }

        // ---- POST /api/create ----
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
                code: upperCode,
                uses: parseInt(uses),
                type,
                value: type === 'balance' ? parseInt(value) : value,
                createdAt: new Date().toISOString()
            };

            savePromos();
            sendJSON(res, 200, { ok: true, promo: promocodes[upperCode] });
            return;
        }

        // ---- POST /api/activate ----
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

            // Начисляем награду юзеру (если промокод денежный)
            if (telegram_id && promo.type === 'balance') {
                const u = ensureUser(telegram_id);
                u.balance = (u.balance || 0) + promo.value;
                saveUsers();
            }

            sendJSON(res, 200, {
                ok: true,
                type: promo.type,
                value: promo.value,
                remaining: promo.uses
            });
            return;
        }

        // ---- GET /api/user/:id ----
        if (req.method === 'GET' && req.url.startsWith('/api/user/')) {
            const id = decodeURIComponent(req.url.slice('/api/user/'.length));
            const u = ensureUser(id);
            saveUsers();
            sendJSON(res, 200, { ok: true, user: u });
            return;
        }

        // ---- POST /api/user/update ----
        if (req.method === 'POST' && req.url === '/api/user/update') {
            const body = await readBody(req);
            const { telegram_id, balance, inventory, roblox_name } = body;
            if (!telegram_id) return sendJSON(res, 400, { ok: false, error: 'telegram_id обязателен' });

            const u = ensureUser(telegram_id);
            if (typeof balance === 'number' && !isNaN(balance)) u.balance = balance;
            if (Array.isArray(inventory)) u.inventory = inventory;
            if (typeof roblox_name === 'string') u.roblox_name = roblox_name;
            saveUsers();
            sendJSON(res, 200, { ok: true, user: u });
            return;
        }

        // ---- POST /api/deposit/create ----
        if (req.method === 'POST' && req.url === '/api/deposit/create') {
            const body = await readBody(req);
            const { telegram_id, username, item_id, item_name, item_price, roblox_name } = body;

            if (!telegram_id) return sendJSON(res, 400, { ok: false, error: 'telegram_id обязателен' });
            if (!item_id) return sendJSON(res, 400, { ok: false, error: 'Не выбран предмет' });
            if (!roblox_name || !roblox_name.trim()) return sendJSON(res, 400, { ok: false, error: 'Введите Roblox ник' });

            // Сохраняем roblox_name в профиль
            const u = ensureUser(telegram_id, username);
            u.roblox_name = roblox_name.trim();
            saveUsers();

            const deposit = {
                id: 'dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                telegram_id,
                username: username || u.username || '',
                item_id,
                item_name: item_name || '',
                item_price: Number(item_price) || 0,
                roblox_name: roblox_name.trim(),
                status: 'pending',
                created_at: new Date().toISOString()
            };
            deposits.push(deposit);
            saveDeposits();
            console.log('[OK] Заявка на пополнение:', deposit.id, 'от', username);
            sendJSON(res, 200, { ok: true, deposit });
            return;
        }

        // ---- GET /api/deposits ----
        if (req.method === 'GET' && req.url === '/api/deposits') {
            sendJSON(res, 200, { ok: true, deposits });
            return;
        }

        // ---- POST /api/deposit/status ----
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

            // Если принята — начисляем баланс
            if (status === 'accepted') {
                const u = ensureUser(dep.telegram_id);
                u.balance = (u.balance || 0) + (Number(dep.item_price) || 0);
                saveUsers();
            }
            saveDeposits();
            sendJSON(res, 200, { ok: true, deposit: dep });
            return;
        }

        // ---- 404 ----
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
