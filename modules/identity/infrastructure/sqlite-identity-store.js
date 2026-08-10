const { db } = require('../../../server/db.js');
const crypto = require('node:crypto');

const sessionId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

class SqliteIdentityStore {
  async emailExists(email) {
    return !!db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  }
  async createUser(input) {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id,role,name,email,pass_hash,pass_salt,phone,tz,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        input.id,
        input.role,
        input.name,
        input.email,
        input.hash,
        input.salt,
        input.phone,
        input.tz,
        input.createdAt,
      );
      if (input.role === 'student') {
        db.prepare(
          `INSERT INTO student_profiles (id,user_id,grade,school,started_at)
          VALUES (?,?,?,?,?)`,
        ).run(input.profileId, input.id, input.grade, input.school, input.createdAt.slice(0, 10));
        const preference = db.prepare(`INSERT INTO notification_prefs
          (user_id,channel,enabled,handle,minutes_before) VALUES (?,?,?,?,?)`);
        preference.run(input.id, 'telegram', 0, '', null);
        preference.run(input.id, 'email', 1, input.email, null);
        preference.run(input.id, 'lesson_reminder', 1, '', 60);
        preference.run(input.id, 'hw_deadline', 1, '', 1440);
      } else {
        db.prepare(
          `INSERT INTO tutor_profiles
          (id,user_id,subjects,years_exp,rate,meeting_url) VALUES (?,?,?,?,?,?)`,
        ).run(
          input.profileId,
          input.id,
          JSON.stringify(input.subjects),
          input.yearsExp,
          input.rate,
          input.meetingUrl,
        );
      }
    })();
    return this.findUserById(input.id);
  }
  async findUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
  }
  async findUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }
  async updatePassword(id, credentials) {
    db.prepare('UPDATE users SET pass_hash=?,pass_salt=? WHERE id=?').run(
      credentials.hash,
      credentials.salt,
      id,
    );
  }
  async markEmailVerified(id, verifiedAt) {
    db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(verifiedAt, id);
  }
  async replaceAccountToken(input) {
    db.transaction(() => {
      db.prepare(
        'DELETE FROM account_tokens WHERE user_id=? AND purpose=? AND consumed_at IS NULL',
      ).run(input.userId, input.purpose);
      db.prepare(
        `INSERT INTO account_tokens
        (token_hash,user_id,purpose,created_at,expires_at,requested_ip,code_hash)
        VALUES (?,?,?,?,?,?,?)`,
      ).run(
        input.tokenHash,
        input.userId,
        input.purpose,
        input.createdAt,
        input.expiresAt,
        input.ip,
        input.codeHash || null,
      );
    })();
  }
  async findAccountToken(criteria, now) {
    const byHandle = Boolean(criteria.tokenHash);
    return (
      db
        .prepare(
          `SELECT token_hash,user_id,code_hash,attempts,expires_at FROM account_tokens
        WHERE ${byHandle ? 'token_hash=?' : 'user_id=?'} AND purpose=?
        AND consumed_at IS NULL AND expires_at>?`,
        )
        .get(byHandle ? criteria.tokenHash : criteria.userId, criteria.purpose, now) || null
    );
  }
  async countAccountTokenAttempt(tokenHash) {
    db.prepare('UPDATE account_tokens SET attempts=attempts+1 WHERE token_hash=?').run(tokenHash);
    const row = db.prepare('SELECT attempts FROM account_tokens WHERE token_hash=?').get(tokenHash);
    return row ? row.attempts : 0;
  }
  async deleteAccountToken(tokenHash) {
    db.prepare('DELETE FROM account_tokens WHERE token_hash=?').run(tokenHash);
  }
  async createTrustedDevice(device) {
    db.prepare(
      `INSERT INTO trusted_devices
      (id,user_id,token_hash,created_at,last_seen_at,expires_at,user_agent)
      VALUES (?,?,?,?,?,?,?)`,
    ).run(
      device.id,
      device.userId,
      device.tokenHash,
      device.createdAt,
      device.createdAt,
      device.expiresAt,
      device.userAgent,
    );
  }
  async touchTrustedDevice(userId, tokenHash, now) {
    const row = db
      .prepare(
        `SELECT id FROM trusted_devices
      WHERE user_id=? AND token_hash=? AND expires_at>?`,
      )
      .get(userId, tokenHash, now);
    if (!row) return null;
    db.prepare('UPDATE trusted_devices SET last_seen_at=? WHERE id=?').run(now, row.id);
    return row.id;
  }
  async deleteTrustedDevicesForUser(userId) {
    db.prepare('DELETE FROM trusted_devices WHERE user_id=?').run(userId);
  }
  async consumeAccountToken(tokenHash, purpose, consumedAt) {
    const row = db
      .prepare(
        `SELECT user_id FROM account_tokens
      WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>?`,
      )
      .get(tokenHash, purpose, consumedAt);
    if (!row) return null;
    const changed = db
      .prepare(
        `UPDATE account_tokens SET consumed_at=?
      WHERE token_hash=? AND consumed_at IS NULL`,
      )
      .run(consumedAt, tokenHash);
    return changed.changes ? row.user_id : null;
  }
  async deleteSessionsForUser(id, exceptToken) {
    if (exceptToken)
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(id, exceptToken);
    else db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  async listSessions(id, currentToken) {
    return db
      .prepare(
        `SELECT token,created_at,expires_at,user_agent
      FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC`,
      )
      .all(id, new Date().toISOString())
      .map((row) => ({
        id: sessionId(row.token),
        created_at: row.created_at,
        expires_at: row.expires_at,
        user_agent: row.user_agent,
        current: row.token === currentToken ? 1 : 0,
      }));
  }
  async deleteSessionById(id, sessionId) {
    const match = db
      .prepare('SELECT token FROM sessions WHERE user_id=?')
      .all(id)
      .find((row) => sessionId === crypto.createHash('sha256').update(row.token).digest('hex'));
    if (match) db.prepare('DELETE FROM sessions WHERE user_id=? AND token=?').run(id, match.token);
  }
  async recordSecurityEvent(event) {
    db.prepare(
      `INSERT INTO security_events
      (id,user_id,event_type,occurred_at,ip,user_agent,metadata) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      event.id,
      event.userId,
      event.type,
      event.occurredAt,
      event.ip,
      event.userAgent,
      JSON.stringify(event.metadata || {}),
    );
  }
  async createSession(session) {
    db.prepare(
      `INSERT INTO sessions (token,user_id,created_at,expires_at,user_agent)
      VALUES (?,?,?,?,?)`,
    ).run(session.token, session.userId, session.createdAt, session.expiresAt, session.userAgent);
  }
  async deleteSession(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  async findSession(token) {
    return token ? db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) || null : null;
  }
  async profileOf(user) {
    if (user.role === 'student')
      return db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id) || null;
    if (user.role === 'tutor')
      return db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(user.id) || null;
    return null;
  }
  async ready() {
    db.prepare('SELECT 1').get();
  }
}

module.exports = { SqliteIdentityStore };
