export type TimerErrorReporter = (label: string, error: unknown) => void;

const REPORT_EVERY_MS = 10_000;
let reporter: TimerErrorReporter | null = null;

/** Where show-timer failures are reported besides stderr (the server wires this to Admin's error log). */
export function setTimerErrorReporter(next: TimerErrorReporter | null): void {
  reporter = next;
}

/**
 * setInterval for the show's own clocks. An exception thrown from a timer
 * callback is uncaught, and an uncaught exception ends the Node process: the
 * container restarts with every show back at idle. A guarded timer reports the
 * failure instead and tries again on its next tick, so one bad frame or scene
 * cannot end the performance. Repeats of a failing tick are reported at most
 * every ten seconds, with a count.
 */
export function guardedInterval(label: string, work: () => void, ms: number, now: () => number = Date.now): ReturnType<typeof setInterval> {
  let lastReportAt = Number.NEGATIVE_INFINITY;
  let suppressed = 0;
  return setInterval(() => {
    try {
      work();
    } catch (error) {
      const at = now();
      if (at - lastReportAt < REPORT_EVERY_MS) {
        suppressed += 1;
        return;
      }
      const repeats = suppressed;
      lastReportAt = at;
      suppressed = 0;
      try {
        console.error(`${label} failed${repeats ? ` (${repeats} more since the last report)` : ""}`, error);
        reporter?.(label, error);
      } catch {
        // Reporting must never be what ends the show.
      }
    }
  }, ms);
}
