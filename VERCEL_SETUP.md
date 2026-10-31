# Развертывание календаря с синхронизацией GitHub

В корне репозитория находятся `index.html`, `api/orders.js` и `api/session.js`. Приложение читает заказы из `IvanDeft/TEST/orders.xml` и сохраняет изменения туда через Vercel Function. Секрет GitHub не попадает в браузер или файлы репозитория.

## Настройка Vercel

1. Импортируйте репозиторий `IvanDeft/TEST` в Vercel и разверните его с корнем проекта по умолчанию.
2. В настройках проекта Vercel → **Environment Variables** добавьте:
   - `GITHUB_TOKEN` — fine-grained token только для репозитория `IvanDeft/TEST`, разрешение **Contents: Read and write**.
   - `ORDERS_APP_PASSWORD` — придуманный вами пароль для первого подключения календаря.
   - `SESSION_SECRET` — случайная строка не короче 32 символов; например, сгенерируйте локально командой `openssl rand -hex 32`.
3. Примените переменные для Production и выполните повторный deployment.
4. Откройте адрес Vercel. При первом изменении заказа календарь запросит `ORDERS_APP_PASSWORD`; затем будет использовать защищенную HttpOnly cookie в течение семи дней.

`GET /api/orders` читает публичный XML. `PUT /api/orders` принимает запись только с действительной сессией и обновляет файл через GitHub Contents API. Без перечисленных переменных или до deployment сайт не сможет записывать изменения в GitHub.
