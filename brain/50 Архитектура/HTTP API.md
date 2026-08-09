---
aliases: [api-v1.js, маршруты, REST, OpenAPI]
tags: [тип/архитектура, статус/готово]
источник: server/api-v1.js
обновлено: 2026-08-09
---

# HTTP API

> Версионированный контракт. Каждый маршрут проверяет роль и владение объектом.

## Контракт v1

`docs/openapi.v1.yaml` — OpenAPI 3.1 и единственный источник типов клиента.
`packages/api-client` генерируется командой `npm run api:generate`. Ошибки имеют
`application/problem+json`, а входящие тела проверяются Zod до domain service.

## Чтение

- `/api/v1/screens/:screen[.js]` — минимальный DTO для одного из 16 экранов;
- `/api/v1/{invites,groups,students,lessons,assignments,attempts,reviews,tasks}` —
  ресурсные списки с opaque cursor, `limit ≤ 100`, фильтрами и сортировкой;
- `/api/v1/me`, `/api/v1/profile`, `/api/v1/lessons/:id` — адресное чтение;
- все чтения поддерживают `ETag` и условный `If-None-Match`.

Frontend больше не вызывает `/api/state.js`. Legacy API временно сохранён под
`/api` для rollback и постепенно удаляется после периода наблюдения.

## Команды

Существующие учебные команды доступны под `/api/v1`. Создание приглашения,
группы, занятия, задания, импорт задач и принятие приглашения требуют
`Idempotency-Key`. PostgreSQL хранит hash запроса и результат: точный повтор
возвращает прежний ответ, а повтор ключа с другим телом отклоняется.

`PATCH /api/v1/lessons/:id` требует `If-Match: "vN"`. Отсутствующий precondition
даёт 428, устаревшая версия — 412, успешная запись повышает `version`.

## Read-модели

`/api/v1/read-models/{student-dashboard,tutor-today,assignment-progress,student-subject-stats}`.
Подробнее: [[Read-модели API v1]].

## Правило

Клиенту не доверяем: `student_id` и `tutor_id` берутся из сессии,
а не из тела запроса.

## Связи

[[Разделение доступа]] · [[Клиент]] · [[Безопасность]] · [[ADR-012 Контекстный API v1]]
