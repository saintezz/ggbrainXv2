// server.js — GGBrainX API (Render-ready) + Topup Leaderboard
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = '/tmp';
const PROMO_FILE = path.join(DATA_DIR, 'promocodes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEPOSITS_FILE = path.join(DATA_DIR, 'deposits.json');
const LUCK_FILE = path.join(DATA_DIR, 'luck.json');
const TOPUPS_FILE = path.join(DATA_DIR, 'topups.json');

const ADMIN_USERNAME = 'clonexx7';

let promocodes = {};
let users = {};
let deposits = [];
let luckState = { multiplier: 1, until: 0, by: '', ts: 0 };
let topupHistory = {}; // { username: totalAmount }

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
    luckState = loadJSON(LUCK_FILE, { multiplier: 1, until: 0, by: '', ts: 0 });
    topupHistory = loadJSON(TOPUPS_FILE, {});
}
function savePromos() { saveJSON(PROMO_FILE, promocodes); }
function saveUsers() { saveJSON(USERS_FILE, users); }
function saveDeposits() { saveJSON(DEPOSITS_FILE, deposits); }
function saveLuck() { saveJSON(LUCK_FILE, luckState); }
function saveTopups() { saveJSON(TOPUPS_FILE, topupHistory); }

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

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        setCORS(res);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GGBrainX server is alive');
        return;
    }

    try {
        // === TOPUP LEADERBOARD ===
        if (req.method === 'GET' && req.url === '/api/topup-leaderboard') {
            const sorted = Object.entries(topupHistory)
                .map(([username, total]) => ({ username, total }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10); // топ 10
            return sendJSON(res, 200, { ok: true, leaderboard: sorted });
        }

        // === PROMOS ===
        if (req.method === 'POST' && req.url === '/api/create') {
            const body = await readBody(req);
            const { code, uses, type, value } = body;
            if (!code || code.trim().length < 3) return sendJSON(res, 400, { ok: false, error: 'Название минимум 3 символа' });
            const upperCode = code.trim().toUpperCase();
            if (promocodes[upperCode]) return sendJSON(res, 409, { ok: false, error: 'Промокод уже есть' });

            promocodes[upperCode] = {
                code: upperCode, uses: parseInt(uses), type,
                value: type === 'balance' ? parseInt(value) : value,
                createdAt: new Date().toISOString()
            };
            savePromos();
            return sendJSON(res, 200, { ok: true, promo: promocodes[upperCode] });
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

            const u = ensureUser(telegram_id);
            if (promo.type === 'balance') {
                u.balance = (u.balance || 0) + promo.value;
                // Добавляем в топ пополнений (по логину)
                if (u.username) {
                    topupHistory[u.username] = (topupHistory[u.username] || 0) + promo.value;
                    saveTopups();
                }
            } else if (promo.type === 'item') {
                if (!Array.isArray(u.inventory)) u.inventory = [];
                u.inventory.push(promo.value);
            }
            u.updated_at = new Date().toISOString();
            saveUsers();
            
            return sendJSON(res, 200, { ok: true, type: promo.type, value: promo.value, remaining: promo.uses });
        }

        if (req.method === 'GET' && req.url === '/api/promocodes') {
            return sendJSON(res, 200, { ok: true, promocodes });
        }

        // === USER ===
        if (req.method === 'GET' && req.url.startsWith('/api/user/')) {
            const id = decodeURIComponent(req.url.slice('/api/user/'.length));
            const u = ensureUser(id);
            saveUsers();
            return sendJSON(res, 200, { ok: true, user: u });
        }
        if (req.method === 'POST' && req.url === '/api/user/update') {
            const body = await readBody(req);
            const { telegram_id, balance, inventory, username, ...rest } = body;
            if (!telegram_id) return sendJSON(res, 400, { ok: false, error: 'telegram_id обязателен' });

            const u = ensureUser(telegram_id, username);
            if (typeof balance === 'number' && !isNaN(balance)) u.balance = balance;
            if (Array.isArray(inventory)) u.inventory = inventory;
            Object.assign(u, rest);
            u.updated_at = new Date().toISOString();
            saveUsers();
            return sendJSON(res, 200, { ok: true, user: u });
        }

        sendJSON(res, 404, { ok: false, error: 'Метод не найден' });
    } catch (err) {
        sendJSON(res, 500, { ok: false, error: err.message });
    }
});

loadAll();
server.listen(PORT, () => console.log('Server started on port ' + PORT));
