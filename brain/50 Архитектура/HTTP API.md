---
aliases: [api.js, маршруты, REST]
tags: [тип/архитектура, статус/готово]
источник: server/api.js
---

# HTTP API

> 26 маршрутов. Каждый проверяет роль и владение объектом.

## Состояние

| метод | путь | кто |
|---|---|---|
| GET | `/api/state` | любой |
| GET | `/api/state.js` | любой — тот же срез как `<script>` |

## Аутентификация

`GET /api/auth/roles` · `POST /api/auth/register` · `POST /api/auth/login`
`POST /api/auth/logout` · `GET /api/auth/me`

## Банк задач

`GET /api/tasks` (без ответов) · `POST /api/tasks/import` — [[Репетитор]]

## Приглашения

`POST /api/invites` · `POST /api/invites/:id/revoke` — [[Репетитор]]
`GET /api/invites/:code` — любой вошедший
`POST /api/invites/accept` — [[Ученик]]

## Занятия и группы — [[Репетитор]]

`POST /api/groups`
`POST /api/lessons`
`POST|DELETE /api/lessons/:id/links[/:index]`
`POST|DELETE /api/lessons/:id/tasks[/:taskId]`
`POST /api/lessons/:id/status`
`POST /api/assignments`

## Работы

`POST /api/attempts/:id/progress` — [[Ученик]], своя попытка
`POST /api/attempts/:id/answer` — сверка на сервере
`POST /api/attempts/:id/submit` — на ручную проверку
`POST /api/attempts/:id/review` — [[Репетитор]]

## Прочее

`POST /api/prefs` — [[NotificationPref]]

## Правило

Клиенту не доверяем: `student_id` и `tutor_id` берутся из сессии,
а не из тела запроса.

## Связи

[[Разделение доступа]] · [[Клиент]] · [[Безопасность]]
