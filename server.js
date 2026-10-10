// server.js — простой сервер для промокодов
// Запуск: node server.js
// Порт: 3000 (можно поменять через process.env.PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'promocodes.json');

// ===== Хранилище промокодов =====
let promocodes = {};

function loadPromocodes() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            promocodes = JSON.parse(raw);
            console.log('[OK] Промокоды загружены:', Object.keys(promocodes).length);
        } else {
            promocodes = {};
            console.log('[OK] Файл промокодов не найден, создан новый');
        }
    } catch (err) {
        console.error('[ERROR] Не удалось загрузить промокоды:', err.message);
        promocodes = {};
    }
}

function savePromocodes() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(promocodes, null, 2), 'utf8');
        console.log('[OK] Промокоды сохранены');
    } catch (err) {
        console.error('[ERROR] Не удалось сохранить промокоды:', err.message);
    }
}

// ===== CORS =====
function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ===== Отправка JSON =====
function sendJSON(res, status, data) {
    setCORS(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

// ===== Чтение тела запроса =====
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error('Неверный JSON в запросе'));
            }
        });
        req.on('error', reject);
    });
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

    try {
        // ---- GET /api/promocodes — список всех промокодов (только для админа) ----
        if (req.method === 'GET' && req.url === '/api/promocodes') {
            sendJSON(res, 200, { ok: true, promocodes });
            return;
        }

        // ---- POST /api/create — создать промокод ----
        if (req.method === 'POST' && req.url === '/api/create') {
            const body = await readBody(req);
            const { code, uses, type, value } = body;

            if (!code || typeof code !== 'string' || code.trim().length < 3) {
                sendJSON(res, 400, { ok: false, error: 'Название промокода минимум 3 символа' });
                return;
            }
            if (!uses || uses < 1) {
                sendJSON(res, 400, { ok: false, error: 'Количество активаций минимум 1' });
                return;
            }
            if (type !== 'balance' && type !== 'item') {
                sendJSON(res, 400, { ok: false, error: 'Тип должен быть balance или item' });
                return;
            }
            if (type === 'balance' && (!value || value < 1)) {
                sendJSON(res, 400, { ok: false, error: 'Сумма монет минимум 1' });
                return;
            }
            if (type === 'item' && !value) {
                sendJSON(res, 400, { ok: false, error: 'Не выбран брейнрот' });
                return;
            }

            const upperCode = code.trim().toUpperCase();

            if (promocodes[upperCode]) {
                sendJSON(res, 409, { ok: false, error: 'Такой промокод уже существует' });
                return;
            }

            promocodes[upperCode] = {
                code: upperCode,
                uses: parseInt(uses),
                type,
                value: type === 'balance' ? parseInt(value) : value,
                createdAt: new Date().toISOString()
            };

            savePromocodes();
            console.log('[OK] Создан промокод:', upperCode);
            sendJSON(res, 200, { ok: true, promo: promocodes[upperCode] });
            return;
        }

        // ---- POST /api/activate — активировать промокод ----
        if (req.method === 'POST' && req.url === '/api/activate') {
            const body = await readBody(req);
            const { code } = body;

            if (!code) {
                sendJSON(res, 400, { ok: false, error: 'Введите промокод' });
                return;
            }

            const upperCode = code.trim().toUpperCase();
            const promo = promocodes[upperCode];

            if (!promo) {
                sendJSON(res, 404, { ok: false, error: 'Промокод не найден' });
                return;
            }
            if (promo.uses <= 0) {
                sendJSON(res, 410, { ok: false, error: 'Промокод больше не активен' });
                return;
            }

            promo.uses -= 1;
            if (promo.uses <= 0) {
                // Не удаляем, чтобы админ видел историю, но помечаем неактивным
                console.log('[INFO] Промокод исчерпан:', upperCode);
            }
            savePromocodes();

            console.log('[OK] Активирован промокод:', upperCode, 'осталось:', promo.uses);
            sendJSON(res, 200, {
                ok: true,
                type: promo.type,
                value: promo.value,
                remaining: promo.uses
            });
            return;
        }

        // ---- 404 ----
        sendJSON(res, 404, { ok: false, error: 'Метод не найден: ' + req.method + ' ' + req.url });

    } catch (err) {
        console.error('[ERROR]', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
    }
});

loadPromocodes();

server.listen(PORT, () => {
    console.log('=========================================');
    console.log('  GGBrainX server запущен');
    console.log('  Порт: ' + PORT);
    console.log('  API:');
    console.log('    GET  /api/promocodes');
    console.log('    POST /api/create');
    console.log('    POST /api/activate');
    console.log('=========================================');
});

server.on('error', (err) => {
    console.error('[ERROR] Сервер не смог запуститься:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error('Порт ' + PORT + ' уже занят. Закройте другой процесс или поменяйте PORT.');
    }
});
