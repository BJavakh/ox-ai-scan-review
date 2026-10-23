import type { Coverage } from '@ox-scan/shared';
import type { Dependency } from '../domain/types.js';

export type ResolvedCoverage = Pick<
  Coverage,
  | 'manifest'
  | 'lockfileVersion'
  | 'accuracy'
  | 'packagesChecked'
  | 'directDependencies'
  | 'transitiveDependencies'
  | 'skippedPackages'
>;

export interface ResolvedDependencies {
  dependencies: Dependency[];
  coverage: ResolvedCoverage;
  /** Human-readable caveats shown in the report. */
  notes: string[];
}

/**
 * Turns manifest files into a dependency list. One implementation per
 * ecosystem; only npm exists today. Implementations parse data only and
 * must never execute repository content.
 */
export interface DependencyResolver {
  readonly ecosystem: Coverage['ecosystem'];
  /** Which of the root files to download. Empty means "not applicable". */
  manifestsToFetch(rootFiles: readonly string[]): string[];
  resolve(files: ReadonlyMap<string, string>): ResolvedDependencies;
}

/** Manifests we recognise but do not scan, reported under coverage. */
export const UNSUPPORTED_MANIFESTS = [
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'requirements.txt',
  'Pipfile.lock',
  'poetry.lock',
  'pyproject.toml',
  'go.mod',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
] as const;
