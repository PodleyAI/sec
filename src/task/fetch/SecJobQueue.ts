/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompositeLimiter,
  ConcurrencyLimiter,
  EvenlySpacedRateLimiter,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  globalServiceRegistry,
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  PostgresRateLimiterStorage,
  RateLimiter,
  wrapQueueStorage,
  type IRateLimiterStorage,
  type Pool,
} from "workglow";
import { SecFetchMaxConcurrent, SecFetchMaxPerSec, SecJobQueueName } from "../../config/Constants";
import { SEC_DB_TYPE } from "../../config/tokens";
import { getPgPool } from "../../util/pg";
import { installEdgarBlockTranslation } from "./edgarBlockResponse";
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
    globalServiceRegistry.has(SEC_DB_TYPE) && globalServiceRegistry.get(SEC_DB_TYPE) === "postgres"
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
  // Through the shared factory, not a bare `new`: the component names are
  // derived from the storage's table names, which are themselves derived from
  // the prefix columns in `SecFetchRateLimiterOptions`. Constructing without
  // that configuration would report the unprefixed components while the reset
  // dropped the prefixed tables — the exact drift the factory exists to close.
  return createSecFetchRateLimiterStorage(getPgPool())
    .getMigrations()
    .map((m) => m.component);
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
 * (default 4/s, under EDGAR's 10/s) no matter how many shards run. The
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

  // Every EDGAR fetch converges here, so this is where the 403 rate-limit
  // interstitial gets re-labelled as the 429 it describes — otherwise a block
  // reads as a permanent client error and the cooldown below is never armed.
  installEdgarBlockTranslation();

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
  // throttle pauses every shard, not just the job that saw the 429. The reader
  // goes straight to the STORAGE sentinel rather than through the limiter's
  // `getNextAvailableTime`, which folds in the rate wall and this instance's
  // local backoff hint — neither of which belongs in a cluster-wide pause.
  setSecFetchLimiter(limiter, async () => {
    const iso = await rateLimiterStorage.getNextAvailableTime(SecJobQueueName);
    const ms = iso ? new Date(iso).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  });

  const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(SecJobQueueName);
  const { messageQueue, jobStore } = wrapQueueStorage(storage);

  const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>(
    SecFetchJob,
    {
      queueName: SecJobQueueName,
      messageQueue,
      jobStore,
      limiter: new CompositeLimiter([
        // FIRST, ahead of the rate limiters, and holding its token until the
        // job reaches a terminal state — which is what makes it a concurrency
        // bound rather than a second rate cap. The two rate limiters below
        // meter STARTS over a time window, so neither can see how many fetches
        // are still running; without this a slow EDGAR admits `rate x latency`
        // requests at once and the descriptor table runs dry. Ordering matters
        // for cost as much as correctness: this counter is in-process, so a
        // rejected claim under saturation costs nothing, while acquiring the
        // cluster limiter first would spend a reserve/release round trip
        // against Postgres on every claim it then has to roll back.
        new ConcurrencyLimiter(SecFetchMaxConcurrent),
        // Local pacing: one start every 1000/maxPerSec ms. The cluster
        // RateLimiter below is a sliding window and will admit a burst of
        // `maxPerSec` in one tick; this is what actually spaces them.
        new EvenlySpacedRateLimiter({
          maxExecutions: SecFetchMaxPerSec,
          windowSizeInSeconds: 1,
        }),
        limiter,
      ]),
      pollIntervalMs: 1,
      // Drop each terminal row the moment its result has been handed to the
      // client. `0` is the immediate-deletion sentinel — the server deletes on
      // the terminal event, AFTER `forwardToClients` has resolved the waiting
      // promise with the output value, so nothing can race the consumer.
      //
      // Without this the queue is append-only: `InMemoryQueueStorage.jobQueue`
      // has no eviction of its own, and a completed row holds `output` — for
      // this queue an ENTIRE filing document, routinely multi-MB for an 8-K
      // full submission. A sweep like `sec spac download 8k` fetches one per
      // filing at {@link SecFetchMaxPerSec}/s and never lets one go, so the
      // heap grows by the whole downloaded corpus until the process dies.
      // Deleting the row costs nothing: the durable copy is the on-disk
      // accessiondocs cache written by {@link SecFetchFileOutputCache}, and no
      // caller reads a row back after completion (`outputForInput` dedup is
      // unused here).
      //
      // It is also what keeps claiming cheap. `next()` filters and sorts the
      // whole array on every poll, at `pollIntervalMs: 1` — against a row set
      // that grew with every filing ever fetched, that alone turns a long
      // sweep quadratic well before it runs out of memory.
      deleteAfterCompletionMs: 0,
      deleteAfterFailureMs: 0,
      deleteAfterDisabledMs: 0,
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
