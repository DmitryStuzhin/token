export type LegacyRow = Readonly<Record<string, unknown>>;

export interface ExtractedDataset {
  readonly sourceFile: string;
  readonly extractedAt: string;
  readonly tables: Readonly<Record<string, readonly LegacyRow[]>>;
}

export interface TargetBatch {
  readonly table: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly conflictColumns: readonly string[];
}

export interface TransformedDataset {
  readonly sourceFile: string;
  readonly transformedAt: string;
  readonly batches: readonly TargetBatch[];
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export interface VerificationReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly sourceFile: string;
  readonly success: boolean;
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly targetCounts: Readonly<Record<string, number>>;
  readonly countMismatches: readonly string[];
  readonly orphanCounts: Readonly<Record<string, number>>;
  readonly aggregateChecks: Readonly<Record<string, unknown>>;
  readonly checksum: string;
  readonly warnings: readonly string[];
}
