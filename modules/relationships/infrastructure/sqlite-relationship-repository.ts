import type { RelationshipRepository, VersionedInvite } from '../application/ports.js';
import type { InviteStatus } from '../domain/invite.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';
import { sqlite } from '../../shared/infrastructure/sqlite.js';

interface InviteRow {
  readonly id: string;
  readonly status: InviteStatus;
  readonly used_count: number;
  readonly max_uses: number | null;
  readonly version: number;
}

export class SqliteRelationshipRepository implements RelationshipRepository {
  public findInvite(id: string): Promise<VersionedInvite | null> {
    const row = sqlite.prepare('SELECT * FROM invites WHERE id = ?').get(id) as
      InviteRow | undefined;
    return Promise.resolve(
      row
        ? {
            id: row.id,
            status: row.status,
            usedCount: row.used_count,
            maxUses: row.max_uses,
            version: row.version,
          }
        : null,
    );
  }

  public async saveInviteStatus(invite: VersionedInvite, status: InviteStatus): Promise<void> {
    await Promise.resolve();
    const result = sqlite
      .prepare('UPDATE invites SET status = ?, version = version + 1 WHERE id = ? AND version = ?')
      .run(status, invite.id, invite.version);
    if (result.changes !== 1) throw new ConcurrencyError('Invite', invite.id);
  }
}
