const { db } = require('../../../server/db.js');

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
