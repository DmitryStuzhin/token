import type { InviteStatus } from '../domain/invite.js';

export interface VersionedInvite {
  readonly id: string;
  readonly status: InviteStatus;
  readonly usedCount: number;
  readonly maxUses: number | null;
  readonly version: number;
}

export interface RelationshipRepository {
  findInvite(id: string): Promise<VersionedInvite | null>;
  saveInviteStatus(invite: VersionedInvite, status: InviteStatus): Promise<void>;
}
