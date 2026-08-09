import type pg from 'pg';
import type { RelationshipRepository, VersionedInvite } from '../application/ports.js';
import type { InviteStatus } from '../domain/invite.js';
import { ConcurrencyError } from '../../shared/domain/errors.js';

interface InviteRow {
  readonly id: string;
  readonly status: InviteStatus;
  readonly used_count: number;
  readonly max_uses: number | null;
  readonly version: number;
}

export class PostgresRelationshipRepository implements RelationshipRepository {
  public constructor(private readonly pool: pg.Pool) {}

  public async findInvite(id: string): Promise<VersionedInvite | null> {
    const result = await this.pool.query<InviteRow>(
      `SELECT id::text, status, used_count, max_uses, version FROM invites
       WHERE id::text = $1 OR legacy_id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          status: row.status,
          usedCount: row.used_count,
          maxUses: row.max_uses,
          version: row.version,
        }
      : null;
  }

  public async saveInviteStatus(invite: VersionedInvite, status: InviteStatus): Promise<void> {
    const result = await this.pool.query(
      `UPDATE invites SET status=$1, version=version+1, updated_at=now()
       WHERE id=$2::uuid AND version=$3`,
      [status, invite.id, invite.version],
    );
    if (result.rowCount !== 1) throw new ConcurrencyError('Invite', invite.id);
  }
}
