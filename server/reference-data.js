const { v7: uuidv7 } = require('uuid');
const Domain = require('../shared/domain.js');

async function ensureReferenceData(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subjectIds = new Map();
    for (const subject of Domain.subjects) {
      const result = await client.query(
        `INSERT INTO subjects (id,code,name,short_name,slug,color,exam)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (code) DO UPDATE SET
           name=EXCLUDED.name, short_name=EXCLUDED.short_name, slug=EXCLUDED.slug,
           color=EXCLUDED.color, exam=EXCLUDED.exam, updated_at=now(), version=subjects.version+1
         RETURNING id::text`,
        [uuidv7(), subject.id, subject.name, subject.short, subject.slug, subject.color,
          JSON.stringify(subject.exam)],
      );
      subjectIds.set(subject.id, result.rows[0].id);
    }

    for (const topic of Domain.topics) {
      await client.query(
        `INSERT INTO topics (id,legacy_id,subject_id,name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (subject_id,name) DO UPDATE SET
           legacy_id=EXCLUDED.legacy_id, updated_at=now(), version=topics.version+1`,
        [uuidv7(), topic.id, subjectIds.get(topic.subjectId), topic.name],
      );
    }

    // A production database created before reference bootstrapping let tutors register
    // without a subject. Restore a usable profile without changing tutors who already
    // made an explicit selection.
    await client.query(
      `INSERT INTO tutor_subjects (tutor_id,subject_id)
       SELECT tp.id,s.id FROM tutor_profiles tp CROSS JOIN subjects s
       WHERE NOT EXISTS (SELECT 1 FROM tutor_subjects ts WHERE ts.tutor_id=tp.id)
       ON CONFLICT DO NOTHING`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureReferenceData };
