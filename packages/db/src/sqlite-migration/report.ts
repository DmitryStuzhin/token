import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationReport } from './types.js';

export async function writeMigrationReports(
  report: VerificationReport,
  directory: string,
): Promise<{ readonly json: string; readonly markdown: string }> {
  await fs.mkdir(directory, { recursive: true });
  const stem = `sqlite-to-postgres-${report.runId}`;
  const jsonFile = path.join(directory, `${stem}.json`);
  const markdownFile = path.join(directory, `${stem}.md`);
  await fs.writeFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const countRows = Object.keys(report.sourceCounts)
    .sort()
    .map(
      (table) =>
        `| ${table} | ${String(report.sourceCounts[table] ?? 0)} | ${String(report.targetCounts[table] ?? 0)} |`,
    )
    .join('\n');
  const orphanRows = Object.entries(report.orphanCounts)
    .map(([name, count]) => `| ${name} | ${String(count)} |`)
    .join('\n');
  const markdown = `# SQLite → PostgreSQL migration report

- Run: \`${report.runId}\`
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}
- Source: \`${report.sourceFile}\`
- Result: **${report.success ? 'SUCCESS' : 'FAILED'}**
- Checksum: \`${report.checksum}\`

## Counts

| Table | Source | Target |
|---|---:|---:|
${countRows}

## Orphans

| Check | Count |
|---|---:|
${orphanRows}

## Aggregate checks

\`\`\`json
${JSON.stringify(report.aggregateChecks, null, 2)}
\`\`\`

## Mismatches

${report.countMismatches.length ? report.countMismatches.map((item) => `- ${item}`).join('\n') : '- none'}

## Warnings

${report.warnings.length ? report.warnings.map((item) => `- ${item}`).join('\n') : '- none'}
`;
  await fs.writeFile(markdownFile, markdown, 'utf8');
  return { json: jsonFile, markdown: markdownFile };
}
