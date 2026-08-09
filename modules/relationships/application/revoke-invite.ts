import type { RelationshipRepository } from './ports.js';
import { DomainError } from '../../shared/domain/errors.js';
import { transitionInvite } from '../domain/invite.js';

export class RevokeInvite {
  public constructor(private readonly repository: RelationshipRepository) {}

  public async execute(inviteId: string): Promise<void> {
    const invite = await this.repository.findInvite(inviteId);
    if (!invite) throw new DomainError('NOT_FOUND', 'Приглашение не найдено');
    await this.repository.saveInviteStatus(invite, transitionInvite(invite.status, 'revoked'));
  }
}
