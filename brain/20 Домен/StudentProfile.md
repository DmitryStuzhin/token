---
aliases: [профиль ученика]
tags: [тип/сущность, роль/ученик, статус/готово]
таблица: student_profiles
источник: server/db.js
---

# StudentProfile — профиль ученика

> Учебная часть [[User]] с ролью `student`. Отдельно от учётной записи,
> потому что у репетитора набор полей другой.

## Поля

`user_id` · `grade` (класс) · `school` · `started_at`

## Зачем отдельная таблица

Все учебные связи ссылаются на `student_profiles.id`, а не на `users.id`.
Это позволяет не тащить в учебную часть ничего из аутентификации.

## Связи

Владелец: [[User]]
Ссылаются: [[Enrollment]], [[GroupMember]], [[TaskAttempt]], [[Goal]],
[[Subscription]], [[MockExam]], [[Guardian]]
