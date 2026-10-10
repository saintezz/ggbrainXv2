const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// КОНФИГ
// ============================================================
const ADMIN_USERNAME = '@saintezz7';
const DATA_FILE = path.join(__dirname, 'data.json');
const SAVE_INTERVAL = 5000;

// ============================================================
// БАЗА
// ============================================================
let DB = {
    users: {},
    promocodes: {},
    withdrawCatalog: [],
    exchangeRules: {},
    recentDrops: []
};

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            DB = Object.assign(DB, JSON.parse(raw));
            console.log('✅ База данных загружена');
        } else {
            fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));
            console.log('📁 База создана');
        }
    } catch (err) {
        console.error('Ошибка загрузки БД:', err);
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));
    } catch (err) {
        console.error('Ошибка сохранения БД:', err);
    }
}

setInterval(saveDB, SAVE_INTERVAL);
process.on('SIGTERM', () => { saveDB(); process.exit(0); });
process.on('SIGINT', () => { saveDB(); process.exit(0); });

// ============================================================
// КАТАЛОГ ПРЕДМЕТОВ
// ============================================================
const ALL_ITEMS = [
    { id: 'cupid', name: 'Cupid Wings', price: 34, img: 'https://github.com/forerer-afk/brainroterX/blob/main/cupid-wings.png?raw=true' },
    { id: 'garama', name: 'Garama and Madundung', price: 41, img: 'https://github.com/forerer-afk/brainroterX/blob/main/garama.png?raw=true' },
    { id: 'burguro', name: 'Burguro and Fryuro', price: 70, img: 'https://github.com/forerer-afk/brainroterX/blob/main/burguru.png?raw=true' },
    { id: 'celestial', name: 'Celestial Pegasus', price: 93, img: 'https://github.com/forerer-afk/brainroterX/blob/main/celestialpegasus.png?raw=true' },
    { id: 'cooki', name: 'Cooki and Milki', price: 130, img: 'https://github.com/forerer-afk/brainroterX/blob/main/cookiandmilki.png?raw=true' },
    { id: 'cerberus', name: 'Cerberus', price: 155, img: 'https://github.com/forerer-afk/brainroterX/blob/main/cerberus.png?raw=true' },
    { id: 'globba', name: 'Globba Steppa', price: 164, img: 'https://github.com/forerer-afk/brainroterX/blob/main/globastepa.png?raw=true' },
    { id: 'rubiko', name: 'Rubiko and Kubiko', price: 395, img: 'https://github.com/forerer-afk/brainroterX/blob/main/Rubiko_and_Kubiko.webp?raw=true' },
    { id: 'lossecret', name: 'Los Secret Combinasionas', price: 419, img: 'https://github.com/forerer-afk/brainroterX/blob/main/lossecretcombination.png?raw=true' },
    { id: 'dragon', name: 'Dragon Cannelloni', price: 890, img: 'https://github.com/forerer-afk/brainroterX/blob/main/dragoncannelloni.png?raw=true' },
    { id: 'hydra', name: 'Hydra Dragon Cannelloni', price: 1220, img: 'https://github.com/forerer-afk/brainroterX/blob/main/hydragoncannelloni.png?raw=true' }
];

function getItemById(id) { return ALL_ITEMS.find(i => i.id === id); }

// ============================================================
// ХЕЛПЕРЫ
// ============================================================
function getOrCreateUser(userId) {
    if (!DB.users[userId]) {
        DB.users[userId] = {
            userId,
            nickname: 'Игрок_' + userId.slice(-4),
            telegram: '',
            balance: 1000,
            inventory: [],
            promoUsed: [],
            createdAt: Date.now(),
            stats: {
                upgradesTotal: 0,
                upgradesSuccess: 0,
                upgradesFail: 0,
                totalEarned: 0,
                totalSpent: 0
            },
            bestDrop: null
        };
        saveDB();
    }
    return DB.users[userId];
}

function addToInventory(user, itemId, count = 1) {
    for (let i = 0; i < count; i++) user.inventory.push(itemId);
}

function removeFromInventory(user, itemId, count = 1) {
    for (let i = 0; i < count; i++) {
        const idx = user.inventory.indexOf(itemId);
        if (idx > -1) user.inventory.splice(idx, 1);
    }
}

function countInInventory(user, itemId) {
    return user.inventory.filter(id => id === itemId).length;
}

function isAdminUser(userId) {
    const user = DB.users[userId];
    if (!user) return false;
    return user.telegram && user.telegram.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

// ============================================================
// API: ПОЛЬЗОВАТЕЛЬ
// ============================================================
app.post('/api/user/init', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const user = getOrCreateUser(userId);
    res.json({ user, isAdmin: isAdminUser(userId) });
});

app.get('/api/items', (req, res) => {
    res.json({ items: ALL_ITEMS });
});

app.post('/api/user/update', (req, res) => {
    const { userId, balance, inventory, stats, bestDrop } = req.body;
    const user = getOrCreateUser(userId);
    if (typeof balance === 'number') user.balance = balance;
    if (Array.isArray(inventory)) user.inventory = inventory;
    if (stats) user.stats = Object.assign(user.stats, stats);
    if (bestDrop) user.bestDrop = bestDrop;
    saveDB();
    res.json({ ok: true });
});

app.post('/api/user/nickname', (req, res) => {
    const { userId, nickname } = req.body;
    if (!userId || !nickname) return res.status(400).json({ error: 'required' });
    const user = getOrCreateUser(userId);
    user.nickname = String(nickname).slice(0, 20);
    saveDB();
    res.json({ ok: true, user });
});

app.post('/api/user/telegram', (req, res) => {
    const { userId, telegram } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const user = getOrCreateUser(userId);
    let tg = String(telegram || '').trim();
    if (tg && !tg.startsWith('@')) tg = '@' + tg;
    user.telegram = tg.slice(0, 32);
    saveDB();
    res.json({ ok: true, user, isAdmin: isAdminUser(userId) });
});

// ============================================================
// API: ПРОМОКОДЫ
// ============================================================
app.post('/api/promo/activate', (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'required' });
    const user = getOrCreateUser(userId);
    const promo = DB.promocodes[code.toUpperCase()];
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    if (promo.usesLeft <= 0) return res.status(400).json({ error: 'Промокод исчерпан' });
    if (promo.usedBy.includes(userId)) return res.status(400).json({ error: 'Вы уже использовали этот промокод' });

    if (promo.reward.coins) {
        user.balance += promo.reward.coins;
        user.stats.totalEarned += promo.reward.coins;
    }
    if (Array.isArray(promo.reward.items)) {
        promo.reward.items.forEach(it => addToInventory(user, it.id, it.count || 1));
    }

    promo.usesLeft -= 1;
    promo.usedBy.push(userId);
    user.promoUsed.push(code.toUpperCase());
    saveDB();
    res.json({ ok: true, reward: promo.reward, user });
});

// ============================================================
// API: ВЫВОД
// ============================================================
app.get('/api/withdraw/catalog', (req, res) => {
    const enabled = DB.withdrawCatalog.filter(w => w.enabled).map(w => ({
        ...w,
        item: getItemById(w.itemId)
    })).filter(w => w.item);
    res.json({ catalog: enabled });
});

app.post('/api/withdraw/request', (req, res) => {
    const { userId, itemId } = req.body;
    if (!userId || !itemId) return res.status(400).json({ error: 'required' });
    const user = getOrCreateUser(userId);

    const catalogEntry = DB.withdrawCatalog.find(w => w.itemId === itemId && w.enabled);
    if (catalogEntry) {
        if (countInInventory(user, itemId) < 1) return res.status(400).json({ error: 'У вас нет этого предмета' });
        removeFromInventory(user, itemId, 1);
        catalogEntry.requests = catalogEntry.requests || [];
        catalogEntry.requests.push({
            userId,
            nickname: user.nickname,
            telegram: user.telegram || '',
            itemId,
            timestamp: Date.now(),
            status: 'pending'
        });
        saveDB();
        return res.json({ ok: true, type: 'direct', message: 'Заявка на вывод создана' });
    }

    const rule = DB.exchangeRules[itemId];
    if (!rule) return res.status(400).json({ error: 'Этот предмет нельзя вывести или обменять' });
    if (countInInventory(user, itemId) < 1) return res.status(400).json({ error: 'У вас нет этого предмета' });

    const offer = {
        originalItemId: itemId,
        originalItem: getItemById(itemId),
        coins: rule.coins || 0,
        items: (rule.items || []).map(it => ({ ...it, item: getItemById(it.id) })).filter(it => it.item)
    };
    res.json({ ok: true, type: 'exchange', offer });
});

app.post('/api/withdraw/exchange', (req, res) => {
    const { userId, itemId } = req.body;
    if (!userId || !itemId) return res.status(400).json({ error: 'required' });
    const user = getOrCreateUser(userId);
    const rule = DB.exchangeRules[itemId];
    if (!rule) return res.status(400).json({ error: 'Правило не найдено' });
    if (countInInventory(user, itemId) < 1) return res.status(400).json({ error: 'У вас нет этого предмета' });

    removeFromInventory(user, itemId, 1);
    if (rule.coins) {
        user.balance += rule.coins;
        user.stats.totalEarned += rule.coins;
    }
    if (Array.isArray(rule.items)) {
        rule.items.forEach(it => addToInventory(user, it.id, it.count || 1));
    }
    saveDB();
    res.json({ ok: true, user });
});

// ============================================================
// API: СТАТИСТИКА
// ============================================================
app.post('/api/drop/record', (req, res) => {
    const { userId, itemId } = req.body;
    if (!userId || !itemId) return res.status(400).json({ error: 'required' });
    const user = getOrCreateUser(userId);
    const item = getItemById(itemId);
    if (!item) return res.status(400).json({ error: 'item not found' });

    if (!user.bestDrop || user.bestDrop.price < item.price) {
        user.bestDrop = { itemId: item.id, name: item.name, price: item.price, img: item.img, timestamp: Date.now() };
    }
    user.stats.upgradesTotal = (user.stats.upgradesTotal || 0) + 1;
    saveDB();
    res.json({ ok: true, bestDrop: user.bestDrop });
});

// ============================================================
// API: АДМИН
// ============================================================
function checkAdmin(req, res, next) {
    const userId = req.headers['x-user-id'] || req.body.userId || req.query.userId;
    if (!userId || !isAdminUser(userId)) {
        return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    next();
}

app.get('/api/admin/whoami', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ isAdmin: false });
    res.json({ isAdmin: isAdminUser(userId), adminUsername: ADMIN_USERNAME });
});

app.get('/api/admin/withdraw', checkAdmin, (req, res) => {
    res.json({
        catalog: DB.withdrawCatalog,
        exchangeRules: DB.exchangeRules,
        allItems: ALL_ITEMS
    });
});

app.post('/api/admin/withdraw/toggle', checkAdmin, (req, res) => {
    const { itemId, enabled } = req.body;
    let entry = DB.withdrawCatalog.find(w => w.itemId === itemId);
    if (!entry) {
        entry = { itemId, enabled: !!enabled };
        DB.withdrawCatalog.push(entry);
    } else {
        entry.enabled = !!enabled;
    }
    saveDB();
    res.json({ ok: true });
});

app.post('/api/admin/withdraw/exchange-rule', checkAdmin, (req, res) => {
    const { itemId, coins, items } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId required' });
    DB.exchangeRules[itemId] = {
        coins: Number(coins) || 0,
        items: Array.isArray(items) ? items : []
    };
    saveDB();
    res.json({ ok: true });
});

app.post('/api/admin/withdraw/exchange-rule/delete', checkAdmin, (req, res) => {
    const { itemId } = req.body;
    delete DB.exchangeRules[itemId];
    saveDB();
    res.json({ ok: true });
});

app.get('/api/admin/promocodes', checkAdmin, (req, res) => {
    res.json({ promocodes: DB.promocodes, allItems: ALL_ITEMS });
});

app.post('/api/admin/promocode/create', checkAdmin, (req, res) => {
    const { code, coins, items, uses } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    const upper = code.toUpperCase();
    DB.promocodes[upper] = {
        code: upper,
        reward: {
            coins: Number(coins) || 0,
            items: Array.isArray(items) ? items : []
        },
        usesLeft: Number(uses) || 1,
        usedBy: []
    };
    saveDB();
    res.json({ ok: true });
});

app.post('/api/admin/promocode/delete', checkAdmin, (req, res) => {
    const { code } = req.body;
    delete DB.promocodes[code.toUpperCase()];
    saveDB();
    res.json({ ok: true });
});

app.get('/api/admin/users', checkAdmin, (req, res) => {
    res.json({ users: Object.values(DB.users) });
});

app.get('/api/admin/withdraw/requests', checkAdmin, (req, res) => {
    const requests = [];
    DB.withdrawCatalog.forEach(w => {
        if (w.requests) {
            w.requests.forEach(r => requests.push({ ...r, itemId: w.itemId }));
        }
    });
    requests.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ requests });
});

// ============================================================
// WEBSOCKET (LIVE BOARD)
// ============================================================
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    try {
        ws.send(JSON.stringify({ type: 'history', drops: DB.recentDrops || [] }));
    } catch (e) {}

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'upgrade_win') {
                const drop = {
                    nickname: String(msg.nickname || 'Игрок').slice(0, 32),
                    itemId: String(msg.itemId || '').slice(0, 64),
                    itemName: String(msg.itemName || '').slice(0, 64),
                    itemImg: String(msg.itemImg || '').slice(0, 512),
                    price: Math.max(0, Math.min(999999, parseInt(msg.price) || 0)),
                    timestamp: Date.now()
                };

                DB.recentDrops.unshift(drop);
                if (DB.recentDrops.length > 30) DB.recentDrops.pop();

                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        try { c.send(JSON.stringify({ type: 'new_drop', drop })); } catch (e) {}
                    }
                });
            }

            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {});
    ws.on('error', () => {});
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        try { ws.ping(); } catch (e) {}
    });
}, 30000);

// ============================================================
// РОУТЫ
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============================================================
// ЗАПУСК
// ============================================================
loadDB();
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 GGbrainX запущен на порту ${PORT}`);
    console.log(`👑 Админ: ${ADMIN_USERNAME}`);
});
