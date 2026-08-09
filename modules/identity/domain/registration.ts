import { DomainError } from '../../shared/domain/errors.js';

export type EnabledRole = 'student' | 'tutor';

export interface RegistrationData {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: EnabledRole;
}

export function validateRegistration(input: RegistrationData): RegistrationData {
  const value = {
    ...input,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
  };
  if (value.name.length < 2) throw new DomainError('VALIDATION_ERROR', 'Укажите имя и фамилию');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email)) {
    throw new DomainError('VALIDATION_ERROR', 'Похоже, email введён с ошибкой');
  }
  if (value.password.length < 4) {
    throw new DomainError('VALIDATION_ERROR', 'Пароль — минимум 4 символа');
  }
  return value;
}
