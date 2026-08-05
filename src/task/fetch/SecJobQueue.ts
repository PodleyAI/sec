/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompositeLimiter,
  EvenlySpacedRateLimiter,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  globalServiceRegistry,
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  type IRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  type Pool,
  PostgresRateLimiterStorage,
  RateLimiter,
  wrapQueueStorage,
} from "workglow";

import { SecFetchMaxPerSec, SecJobQueueName } from "../../config/Constants";
import { SEC_DB_TYPE } from "../../config/tokens";
import { getPgPool } from "../../util/pg";
import { SecFetchJob } from "./SecFetchJob";
import { SecFetchRateLimiterOptions } from "./secFetchRateLimiterConfig";
import { setSecFetchLimiter } from "./secFetchThrottle";

export interface SecJobQueueHandles {
  readonly server: JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>;
  readonly client: JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>;
  readonly storage: InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>;
}

function isPostgres(): boolean {
  return (
    globalServiceRegistry.has(SEC_DB_TYPE) &&
    globalServiceRegistry.get(SEC_DB_TYPE) === "postgres"
  );
}

/**
 * Builds the Postgres rate-limiter storage from {@link SecFetchRateLimiterOptions}.
 *
 * Every construction goes through here so the tables the limiter creates and
 * the tables `db reset` drops are derived from the same configuration.
 */
export function createSecFetchRateLimiterStorage(pool: Pool): PostgresRateLimiterStorage {
  return new PostgresRateLimiterStorage(pool, SecFetchRateLimiterOptions);
}

/**
 * Creates the shared rate-limiter's Postgres tables. Called once from
 * {@link setupAllDatabases} (i.e. `db setup`) — NOT per process — so a
 * multi-shard launch never races on the DDL. No-op on non-Postgres backends.
 */
export async function setupSecFetchRateLimiter(): Promise<void> {
  if (!isPostgres()) return;
  await createSecFetchRateLimiterStorage(getPgPool()).migrate();
}

/**
 * The applied-version ledger components {@link setupSecFetchRateLimiter} records
 * rows under, so a reset that drops the rate-limiter tables can clear exactly
 * those rows and nothing else. Read back from the storage that writes them
 * rather than spelled out here, so the two cannot drift apart.
 *
 * Empty off Postgres: the other backends use an in-memory limiter, which
 * records nothing.
 */
export function secFetchRateLimiterLedgerComponents(): ReadonlyArray<string> {
  if (!isPostgres()) return [];
  return new PostgresRateLimiterStorage(getPgPool()).getMigrations().map((m) => m.component);
}

let handles: SecJobQueueHandles | undefined;

/**
 * Lazily builds (once per process) the SEC fetch queue and its rate limiter.
 *
 * EDGAR enforces ~10 requests/second per IP; exceeding it risks a block. When
 * multiple processes fan out (e.g. `update forms --shard 1/6 … 6/6`) they must
 * therefore share ONE fetch budget. On Postgres we back the primary
 * {@link RateLimiter} with {@link PostgresRateLimiterStorage} (scope
 * "cluster"), whose sliding-window reservation is enforced across every process
 * via shared tables — so the aggregate fetch rate stays ≤ {@link SecFetchMaxPerSec}
 * (default 8/s, under EDGAR's 10/s) no matter how many shards run. The
 * per-process {@link EvenlySpacedRateLimiter} only smooths
 * local bursts; the cluster limiter is the authoritative global cap. On
 * sqlite / single-process there is no cluster to coordinate, so an in-memory
 * limiter suffices.
 *
 * The QUEUE ITSELF stays in-memory per process on purpose: fetch payloads are
 * whole filing documents (often multi-MB), and round-tripping each one through
 * Postgres as a job result would swamp the DB for no gain — with accession-hash
 * sharding no two processes fetch the same document, so a shared job store adds
 * only overhead. Sharing the *rate budget* is what prevents the block; sharing
 * the payload queue is not needed.
 *
 * Must be called AFTER DI/env setup (the CLI preAction hook), because the
 * Postgres path reads `getPgPool()` and SEC_DB_TYPE from the registry. The
 * rate-limiter tables must already exist (see {@link setupSecFetchRateLimiter},
 * run by `db setup`).
 */
export async function getSecJobQueue(): Promise<SecJobQueueHandles> {
  if (handles) return handles;

  const rateLimiterStorage: IRateLimiterStorage = isPostgres()
    ? createSecFetchRateLimiterStorage(getPgPool())
    : new InMemoryRateLimiterStorage();

  const limiter = new RateLimiter(rateLimiterStorage, SecJobQueueName, {
    maxExecutions: SecFetchMaxPerSec,
    windowSizeInSeconds: 1,
    initialBackoffDelay: 1000,
    backoffMultiplier: 2,
    maxBackoffDelay: 60000,
  });
  // Expose the cluster-scoped limiter to the 429 cooldown path so an EDGAR
  // throttle pauses every shard, not just the job that saw the 429.
  setSecFetchLimiter(limiter);

  const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(SecJobQueueName);
  const { messageQueue, jobStore } = wrapQueueStorage(storage);

  const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>(
    SecFetchJob,
    {
      queueName: SecJobQueueName,
      messageQueue,
      jobStore,
      limiter: new CompositeLimiter([
        limiter,
        new EvenlySpacedRateLimiter({
          maxExecutions: SecFetchMaxPerSec,
          windowSizeInSeconds: 1,
        }),
      ]),
      pollIntervalMs: 1,
    }
  );

  const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
    messageQueue,
    jobStore,
    queueName: SecJobQueueName,
  });

  client.attach(server);

  handles = { server, client, storage };
  return handles;
}
