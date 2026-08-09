export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_TRANSITION';

export class DomainError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ConcurrencyError extends DomainError {
  public constructor(entity: string, id: string) {
    super('CONFLICT', `${entity} «${id}» уже изменён другим запросом`);
    this.name = 'ConcurrencyError';
  }
}
