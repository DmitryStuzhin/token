# Runbook: SQLite → PostgreSQL cutover

Дата: 2026-08-08  
Владелец: backend/platform

## Предварительные условия

- PostgreSQL 16 доступен только по защищённой сети;
- `DATABASE_URL` хранится в secret manager, не в репозитории;
- `npm run check`, `npm test`, contract suite и schema rehearsal проходят;
- выполнены два rehearsal-прогона на свежих PostgreSQL-базах;
- сохранены JSON и Markdown отчёты без mismatch/orphan;
- определено окно rollback, по умолчанию 24 часа.

## Rehearsal

```bash
npm run db:migrate
npm run db:migrate-from-sqlite -- --source data/token.db --report-dir migration-reports/rehearsal-1
npm run db:migrate-from-sqlite -- --source data/token.db --report-dir migration-reports/rehearsal-2
```

Повторный запуск на той же базе обязан быть идемпотентным. Число вставленных
строк равно нулю, checksum и агрегаты не меняются.

## Cutover

1. Включить `WRITE_FREEZE=true`; дождаться завершения активных HTTP-команд.
2. Создать и проверить backup:

   ```bash
   npm run db:backup-sqlite -- backups/cutover
   npm run db:verify-sqlite-backup -- backups/cutover/token-....db.json
   ```

3. Запустить final delta и verify:

   ```bash
   npm run db:migrate
   npm run db:migrate-from-sqlite -- --source data/token.db --report-dir migration-reports/final
   ```

4. Переключить `DATABASE_DRIVER=postgres`, задать `DATABASE_URL`, выполнить
   rolling restart.
5. Проверить `/health/ready`, вход, приглашение, занятие, попытку и review.
6. Снять `WRITE_FREEZE` только после успешного smoke test.
7. SQLite-файл и backup оставить read-only минимум на 24 часа.

## Rollback

Rollback разрешён, пока после переключения не появились записи только в
PostgreSQL. В течение окна:

1. включить `WRITE_FREEZE=true`;
2. остановить API;
3. проверить backup через `db:verify-sqlite-backup`;
4. установить `DATABASE_DRIVER=sqlite` и `TOKEN_DB` на проверенную копию;
5. запустить API, проверить `/health/ready` и основные сценарии;
6. зафиксировать incident и не удалять PostgreSQL для расследования.

Если PostgreSQL уже принял новые записи, автоматический rollback запрещён:
нужна обратная delta-миграция и отдельное решение владельца данных.

## Contract и производительность

Один repository contract выполняется против SQLite и PostgreSQL. Индексы
проверяются `EXPLAIN (FORMAT JSON)` с ожидаемым index scan. После production
cutover сравниваются p95 и payload с `docs/performance-baseline.md`; допустимое
ухудшение p95 — не более 10%.
