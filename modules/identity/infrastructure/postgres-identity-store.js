const crypto = require('node:crypto');

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

class PostgresIdentityStore {
  constructor(pool) {
    this.pool = pool;
  }
  async emailExists(email) {
    return (
      (await this.pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]))
        .rowCount > 0
    );
  }
  async createUser(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users
        (id,role,name,email,pass_hash,pass_salt,phone,tz,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          input.id,
          input.role,
          input.name,
          input.email,
          input.hash,
          input.salt,
          input.phone,
          input.tz,
          input.createdAt,
        ],
      );
      if (input.role === 'student') {
        await client.query(
          `INSERT INTO student_profiles
          (id,user_id,grade,school,started_at) VALUES ($1,$2,$3,$4,$5)`,
          [input.profileId, input.id, input.grade, input.school, input.createdAt.slice(0, 10)],
        );
        await client.query(
          `INSERT INTO notification_prefs
          (user_id,channel,enabled,handle,minutes_before) VALUES
          ($1,'telegram',false,'',NULL),($1,'email',true,$2,NULL),
          ($1,'lesson_reminder',true,'',60),($1,'hw_deadline',true,'',1440)`,
          [input.id, input.email],
        );
      } else {
        await client.query(
          `INSERT INTO tutor_profiles
          (id,user_id,years_exp,rate_minor,meeting_url) VALUES ($1,$2,$3,$4,$5)`,
          [input.profileId, input.id, input.yearsExp, input.rate * 100, input.meetingUrl],
        );
        for (const code of input.subjects) {
          await client.query(
            `INSERT INTO tutor_subjects (tutor_id,subject_id)
            SELECT $1,id FROM subjects WHERE code=$2 ON CONFLICT DO NOTHING`,
            [input.profileId, code],
          );
        }
      }
      await client.query('COMMIT');
      return this.findUserById(input.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async findUserByEmail(email) {
    const result = await this.pool.query(
      `SELECT COALESCE(legacy_id,id::text) id,role,name,email,
      pass_hash,pass_salt,phone,tz,created_at FROM users WHERE lower(email)=lower($1) LIMIT 1`,
      [email],
    );
    return result.rows[0] || null;
  }
  async findUserById(id) {
    const result = await this.pool.query(
      `SELECT COALESCE(legacy_id,id::text) id,role,name,email,
      pass_hash,pass_salt,phone,tz,created_at FROM users WHERE id::text=$1 OR legacy_id=$1 LIMIT 1`,
      [id],
    );
    return result.rows[0] || null;
  }
  async internalUserId(id) {
    const result = await this.pool.query(
      'SELECT id::text FROM users WHERE id::text=$1 OR legacy_id=$1 LIMIT 1',
      [id],
    );
    return result.rows[0]?.id || null;
  }
  async createSession(session) {
    await this.pool.query(
      `INSERT INTO sessions (token_hash,user_id,created_at,expires_at,user_agent)
      VALUES ($1,$2,$3,$4,$5)`,
      [
        tokenHash(session.token),
        await this.internalUserId(session.userId),
        session.createdAt,
        session.expiresAt,
        session.userAgent,
      ],
    );
  }
  async deleteSession(token) {
    if (token)
      await this.pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
  }
  async findSession(token) {
    if (!token) return null;
    const result = await this.pool.query(
      `SELECT s.user_id::text user_id,s.expires_at
      FROM sessions s WHERE token_hash=$1`,
      [tokenHash(token)],
    );
    return result.rows[0] || null;
  }
  async profileOf(user) {
    const userId = await this.internalUserId(user.id);
    if (user.role === 'student') {
      const result = await this.pool.query(
        `SELECT COALESCE(legacy_id,id::text) id,
        COALESCE((SELECT legacy_id FROM users WHERE id=user_id),user_id::text) user_id,
        grade,school,started_at FROM student_profiles WHERE user_id=$1`,
        [userId],
      );
      return result.rows[0] || null;
    }
    if (user.role === 'tutor') {
      const result = await this.pool.query(
        `SELECT COALESCE(legacy_id,id::text) id,
        COALESCE((SELECT legacy_id FROM users WHERE id=user_id),user_id::text) user_id,
        years_exp,rate_minor/100 rate,meeting_url FROM tutor_profiles WHERE user_id=$1`,
        [userId],
      );
      return result.rows[0] || null;
    }
    return null;
  }
  async ready() {
    await this.pool.query('SELECT 1');
  }
}

module.exports = { PostgresIdentityStore };
