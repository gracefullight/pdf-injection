/**
 * In-process background-run queue for §2 model-tests and §4 robustness runs
 * (contract: "Background runs (model tests, robustness) are in-process async
 * with sqlite persistence and polling endpoints"). Bounded concurrency across
 * concurrently *running* jobs (distinct from `PS_MODEL_TEST_CONCURRENCY`,
 * which bounds provider calls *within* a single run — that's handled inside
 * `runMatrix()`); an `AbortController` per run so `DELETE .../:runId` can
 * cancel an in-flight run.
 *
 * A task is responsible for persisting its own status transitions (queued ->
 * running -> completed/failed/cancelled) via the runs repository — this
 * runner only schedules and tracks cancellation, it never touches the DB.
 */
export type BackgroundTask = (signal: AbortSignal) => Promise<void>;

interface QueueItem {
  runId: string;
  task: BackgroundTask;
}

export class BackgroundRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly queue: QueueItem[] = [];
  private active = 0;

  constructor(private readonly maxConcurrentRuns: number = 4) {}

  /** Schedules `task` to run (immediately, if under the concurrency cap; otherwise once a slot frees up). Never throws synchronously. */
  submit(runId: string, task: BackgroundTask): void {
    this.controllers.set(runId, new AbortController());
    this.queue.push({ runId, task });
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrentRuns && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      const controller = this.controllers.get(item.runId);
      if (!controller) continue; // cancelled before it got a slot
      this.active++;
      void item
        .task(controller.signal)
        .catch(() => {
          // Tasks must persist their own failure/cancellation status via
          // the runs repository; swallow here so a rejection never becomes
          // an unhandled promise rejection in the server process.
        })
        .finally(() => {
          this.controllers.delete(item.runId);
          this.active--;
          this.pump();
        });
    }
  }

  /**
   * Aborts `runId`'s signal (if it is queued or currently running) and
   * removes it from the queue if it hadn't started yet. Returns `true` when
   * a controller existed (i.e. the run was known to this runner at all).
   * The task itself is responsible for checking `signal.aborted` and
   * persisting a "cancelled" status — this method does not touch the DB.
   */
  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    const idx = this.queue.findIndex((q) => q.runId === runId);
    if (idx !== -1) this.queue.splice(idx, 1);
    return true;
  }

  isTracked(runId: string): boolean {
    return this.controllers.has(runId);
  }
}
