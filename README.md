# elma-request-relay

Простой HTTP-релей на Express + TypeScript: принимает описание запроса в теле POST и переотправляет его на указанный сервер, возвращая статус и ответ. Удобно, когда нужно ходить во внешний API из среды, где прямой исходящий запрос недоступен.

Готовый образ: [`duphhh/elma-request-relay`](https://hub.docker.com/r/duphhh/elma-request-relay) на Docker Hub.

## Требования

- Node.js 20+
- Docker (для сборки и публикации образа)

## Структура проекта

```
.
├── src/
│   └── index.ts          # код релея
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .gitignore
└── .env                  # не коммитится
```

## Переменные окружения

Все опциональны. Если не заданы — релей работает без ограничений.

| Переменная         | По умолчанию | Назначение                                                          |
|--------------------|--------------|---------------------------------------------------------------------|
| `PORT`             | `3030`       | Порт сервера                                                        |
| `FETCH_TIMEOUT_MS` | `15000`      | Таймаут исходящего запроса, мс                                     |
| `RELAY_TOKEN`      | —            | Если задан, требует заголовок `x-relay-token` с этим значением     |
| `ALLOWED_HOSTS`    | —            | Белый список хостов через запятую (напр. `api.example.com,foo.bar`) |

Пример `.env`:

```env
PORT=3030
RELAY_TOKEN=ваш-секрет
ALLOWED_HOSTS=api.example.com,mail.example.com
FETCH_TIMEOUT_MS=15000
```

## Разработка и запуск локально

```bash
npm install
npm run build      # tsc -> dist/index.js
npm start          # node dist/index.js
```

Сервер поднимется на `http://localhost:3030`.

## API

### POST /forward

| Поле       | Тип           | Обязательное | Описание                                   |
|------------|---------------|--------------|--------------------------------------------|
| `method`   | string        | да           | HTTP-метод (GET, POST, PUT, …)             |
| `endpoint` | string        | да           | Полный URL целевого сервера                |
| `headers`  | object        | нет          | Заголовки для целевого запроса             |
| `body`     | object/string | нет          | Тело запроса (объект сериализуется в JSON) |

```bash
curl -X POST http://localhost:3030/forward \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "endpoint": "https://httpbin.org/post",
    "headers": { "X-Custom": "value" },
    "body": { "hello": "world" }
  }'
```

Если включён `RELAY_TOKEN`, добавьте заголовок `-H "x-relay-token: ваш-секрет"`.

Ответ:

```json
{
  "status": 200,
  "statusText": "OK",
  "data": { "...": "ответ целевого сервера" }
}
```

### GET /health

Проверка живости — возвращает `{ "status": "ok" }`.

## Сборка образа из исходников

```bash
docker build -t elma-request-relay .
docker run -p 3030:3030 --env-file .env elma-request-relay
```

## Публикация образа в Docker Hub

### 1. Войти

```bash
docker login
```

Логин и access token из Docker Hub → Account Settings → Security (токен предпочтительнее пароля).

### 2. Собрать с тегом `<логин>/<имя>:<версия>`

```bash
docker build -t duphhh/elma-request-relay:latest -t duphhh/elma-request-relay:1.0.0 .
```

### 3. Запушить

```bash
docker push duphhh/elma-request-relay:latest
docker push duphhh/elma-request-relay:1.0.0
```

### Мультиархитектурная сборка

Если собираете на Mac с Apple Silicon (arm64), а сервер на amd64, обычный `build` даст образ под arm64, и на сервере он не запустится. Собирайте через buildx сразу под обе платформы:

```bash
docker buildx create --use --name multiarch     # один раз

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t duphhh/elma-request-relay:latest \
  --push .
```

`--push` обязателен: buildx не кладёт мультиарх-образ в локальный кэш, а публикует напрямую.

## Деплой через docker-compose

`docker-compose.yml` тянет готовый образ из реестра:

```bash
docker compose pull
docker compose up -d
```

Чтобы compose собирал образ из локального кода, добавьте в сервис `build: .`.
