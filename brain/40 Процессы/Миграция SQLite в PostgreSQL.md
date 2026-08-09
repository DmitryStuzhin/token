---
aliases: [cutover PostgreSQL, перенос базы, rollback базы]
tags: [тип/процесс, статус/готово]
источник: docs/RUNBOOK POSTGRESQL CUTOVER.md
выполнено: 2026-08-08
---

# Миграция SQLite в PostgreSQL

> Повторяемый перенос с проверкой данных и возможностью безопасного отката.

## Поток

1. Проверить миграции PostgreSQL и сделать две rehearsal-миграции копии SQLite.
2. Включить `WRITE_FREEZE=true` и убедиться, что запись отвечает HTTP 503.
3. Создать online backup SQLite, проверить SHA-256 и `integrity_check`.
4. Выполнить финальный `db:migrate-from-sqlite`; проверить counts, orphan records,
   агрегаты и checksum в JSON/Markdown-отчёте.
5. Запустить приложение с `DATABASE_DRIVER=postgres` и сохранить SQLite readonly.
6. Наблюдать ошибки и p95; при критичной регрессии вернуть SQLite до новой записи
   в PostgreSQL. После записи откат требует обратной синхронизации.

Команды и критерии решения описаны в `docs/RUNBOOK POSTGRESQL CUTOVER.md`.

## Текущее развёртывание

Локальный PostgreSQL 16.4 запущен в Docker на `127.0.0.1:55432`; данные лежат в
именованном Docker volume. SQLite перенесён 2026-08-08: 6 пользователей,
91 задача, 2 занятия и 2 попытки. Два verify-прогона дали одинаковый checksum,
0 orphan records и 0 count mismatch. Приложение использует PostgreSQL через
локальный `.env`; SQLite и проверенный backup сохранены для отката.

## Связи

[[База данных]] · [[ADR-011 PostgreSQL и Kysely]] · [[Риски]] ·
[[План технической реализации]]
