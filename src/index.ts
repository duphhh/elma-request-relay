import express, { Request, Response } from 'express';

const app = express();

const PORT = Number(process.env.PORT) || 3030;

// Таймаут на исходящий запрос (мс)
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;

// Опциональная защита: если задан RELAY_TOKEN, требуем заголовок x-relay-token
const RELAY_TOKEN = process.env.RELAY_TOKEN;

// Опциональный allow-list хостов через запятую: ALLOWED_HOSTS=api.example.com,foo.bar
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// Заголовки, которые нельзя пробрасывать как есть
const HOP_BY_HOP = new Set(['host', 'content-length', 'connection']);

interface ForwardBody {
    method?: string;
    endpoint?: string;
    headers?: Record<string, string>;
    body?: unknown;
}

// Парсинг входящего JSON (с разумным лимитом размера)
app.use(express.json({ limit: '5mb' }));

app.post('/forward', async (req: Request, res: Response) => {
    // Проверка токена (если включён)
    if (RELAY_TOKEN && req.header('x-relay-token') !== RELAY_TOKEN) {
        return res.status(401).json({ error: 'Неавторизованный запрос' });
    }

    const { method, endpoint, headers, body } = req.body as ForwardBody;

    // Валидация обязательных полей
    if (typeof method !== 'string' || typeof endpoint !== 'string') {
        return res.status(400).json({
            error: 'Поля "method" и "endpoint" обязательны и должны быть строками',
        });
    }

    const upperMethod = method.toUpperCase();
    if (!ALLOWED_METHODS.has(upperMethod)) {
        return res.status(400).json({ error: `Метод ${upperMethod} не поддерживается` });
    }

    // Разбираем и проверяем целевой URL
    let targetUrl: URL;
    try {
        targetUrl = new URL(endpoint);
    } catch {
        return res.status(400).json({ error: 'Некорректный URL в поле "endpoint"' });
    }

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Разрешены только схемы http/https' });
    }

    if (ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(targetUrl.hostname.toLowerCase())) {
        return res.status(403).json({ error: `Хост ${targetUrl.hostname} не разрешён` });
    }

    // Копируем переданные заголовки, убираем hop-by-hop
    const outHeaders: Record<string, string> = {};
    if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
            if (!HOP_BY_HOP.has(key.toLowerCase())) {
                outHeaders[key] = String(value);
            }
        }
    }

    const fetchOptions: RequestInit = {
        method: upperMethod,
        headers: outHeaders,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    };

    // Тело только для методов, которые его допускают
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && body !== undefined && body !== null) {
        if (typeof body === 'object') {
            fetchOptions.body = JSON.stringify(body);
            // Автоматически добавляем Content-Type, если его забыли указать
            const hasContentType = Object.keys(outHeaders).some(
                (h) => h.toLowerCase() === 'content-type'
            );
            if (!hasContentType) {
                outHeaders['Content-Type'] = 'application/json';
            }
        } else {
            // Тело уже строкой/текстом
            fetchOptions.body = String(body);
        }
    }

    try {
        const response = await fetch(targetUrl, fetchOptions);
        const responseText = await response.text();

        // Пробуем распарсить как JSON, иначе отдаём как текст
        let responseData: unknown;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = responseText;
        }

        res.status(response.status).json({
            status: response.status,
            statusText: response.statusText,
            data: responseData,
        });
    } catch (error) {
        const name = (error as { name?: string })?.name;
        const isTimeout = name === 'TimeoutError' || name === 'AbortError';
        const details = error instanceof Error ? error.message : String(error);

        console.error('Ошибка при переотправке запроса:', error);
        res.status(isTimeout ? 504 : 502).json({
            error: isTimeout
                ? 'Таймаут при обращении к целевому серверу'
                : 'Ошибка проксирования',
            details,
        });
    }
});

// Простой health-check
app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Сервер переотправки запущен на http://localhost:${PORT}`);
});