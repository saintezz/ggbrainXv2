const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    // Важно для Render: разрешаем любые origin (Render использует прокси)
    verifyClient: () => true
});

// Отдаём статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (нужен для Render)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        clients: clients.size,
        uptime: process.uptime()
    });
});

// История последних дропов
const recentDrops = [];
const MAX_HISTORY = 30;

// Хранилище всех подключений
const clients = new Set();

wss.on('connection', (ws, req) => {
    clients.add(ws);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[+] Клиент подключился (${ip}). Всего: ${clients.size}`);

    // Отправляем новому клиенту историю
    try {
        ws.send(JSON.stringify({
            type: 'history',
            drops: recentDrops
        }));
    } catch (err) {
        console.error('Ошибка отправки истории:', err);
    }

    // ★★★ ПИНГ-ПОНГ для стабильности соединения на Render ★★★
    // Render рвёт соединение если оно idle > ~55 секунд
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Обработка сообщений
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

                recentDrops.unshift(drop);
                if (recentDrops.length > MAX_HISTORY) recentDrops.pop();

                broadcast({ type: 'new_drop', drop });
                console.log(`📥 Дроп: ${drop.nickname} → ${drop.itemName} (${drop.price})`);
            }

            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            console.error('Ошибка парсинга:', err.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[-] Клиент отключился. Всего: ${clients.size}`);
    });

    ws.on('error', (err) => {
        console.error('WebSocket ошибка:', err.message);
        clients.delete(ws);
    });
});

// ★★★ HEARTBEAT: каждые 30 секунд проверяем живых клиентов ★★★
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('💀 Мёртвое соединение, отключаю');
            return ws.terminate();
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (err) {
            console.error('Ошибка пинга:', err.message);
        }
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Рассылка всем
function broadcast(data) {
    const json = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(json);
            } catch (err) {
                console.error('Ошибка broadcast:', err.message);
            }
        }
    });
}

// ★★★ ВАЖНО ДЛЯ RENDER: слушаем 0.0.0.0 и используем PORT ★★★
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 GGbrainX сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket слушает`);
    console.log(`🌐 Открой http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM получен, закрываю сервер...');
    clearInterval(heartbeat);
    server.close(() => {
        console.log('Сервер закрыт');
        process.exit(0);
    });
});
