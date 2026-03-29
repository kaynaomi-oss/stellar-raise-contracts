/**
 * @title Frontend Header Responsive — Test Suite
 * @notice Comprehensive unit and property-based tests for the logging subsystem.
 * @dev Uses vitest + fast-check. Each property test runs a minimum of 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  LogLevel,
  LogEntry,
  LogBound,
  BoundedLogger,
  DEFAULT_LOG_BOUND,
  BreakpointValidator,
  FrontendHeaderResponsiveError,
  updateBreakpoint,
} from "../utils/frontend_header_responsive";
import { clampLogBound } from "./frontend_header_responsive";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const logLevelArb = fc.constantFrom(
  LogLevel.debug,
  LogLevel.info,
  LogLevel.warn,
  LogLevel.error,
);

const isoTimestampArb = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2099-12-31") })
  .map((d) => d.toISOString());

/** Generates a valid LogEntry with JSON-serialisable meta values. */
const logEntryArb: fc.Arbitrary<LogEntry> = fc.record({
  timestamp: isoTimestampArb,
  level: logLevelArb,
  category: fc.string({ minLength: 1, maxLength: 32 }),
  message: fc.string({ minLength: 1, maxLength: 128 }),
  meta: fc.option(
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 16 }),
      fc.oneof(
        fc.string({ maxLength: 64 }),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
      ),
    ),
    { nil: undefined },
  ),
});

/** Creates a fresh BoundedLogger with a very large window so tests don't hit limits. */
function makeLogger(bound: LogBound = DEFAULT_LOG_BOUND): BoundedLogger {
  return new BoundedLogger(bound);
}

// ---------------------------------------------------------------------------
// BoundedLogger — unit tests
// ---------------------------------------------------------------------------

describe("BoundedLogger", () => {
  it("[unit] starts with empty entries and zero droppedCount", () => {
    const logger = makeLogger();
    expect(logger.getEntries()).toHaveLength(0);
    expect(logger.getDroppedCount()).toBe(0);
  });

  it("[unit] stores an emitted entry", () => {
    const logger = makeLogger();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.info,
      category: "test",
      message: "hello",
    };
    logger.emit(entry);
    expect(logger.getEntries()).toHaveLength(1);
    expect(logger.getEntries()[0].message).toBe("hello");
  });

  it("[unit] reset clears entries and droppedCount", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 10,
      maxEntriesPerWindow: 2,
      windowMs: 60000,
    });
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.debug,
      category: "test",
      message: "x",
    };
    logger.emit(entry);
    logger.emit(entry);
    logger.emit(entry); // dropped
    expect(logger.getDroppedCount()).toBe(1);
    logger.reset();
    expect(logger.getEntries()).toHaveLength(0);
    expect(logger.getDroppedCount()).toBe(0);
  });

  it("[unit] sanitises HTML tags in meta string values", () => {
    const logger = makeLogger();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.warn,
      category: "security",
      message: "injection attempt",
      meta: { value: "<script>alert(1)</script>" },
    };
    logger.emit(entry);
    const stored = logger.getEntries()[0];
    // <script> and </script> are two separate tags; text between them is preserved.
    expect((stored.meta as Record<string, unknown>)["value"]).toBe(
      "[REDACTED_HTML]alert(1)[REDACTED_HTML]",
    );
  });

  it("[unit] droppedCount increments when window limit exceeded", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 10,
      maxEntriesPerWindow: 3,
      windowMs: 60000,
    });
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.info,
      category: "test",
      message: "msg",
    };
    for (let i = 0; i < 5; i++) logger.emit(entry);
    expect(logger.getEntries()).toHaveLength(3);
    expect(logger.getDroppedCount()).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Property 1: Emitted entries conform to LogEntry shape
  // Feature: frontend-header-responsive-logging, Property 1: Emitted entries conform to LogEntry shape
  // Validates: Requirements 1.2, 1.4
  // -------------------------------------------------------------------------
  it("[property] Property 1: emitted entries conform to LogEntry shape", () => {
    // Feature: frontend-header-responsive-logging, Property 1: Emitted entries conform to LogEntry shape
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const logger = makeLogger();
          for (const e of entries) logger.emit(e);
          for (const stored of logger.getEntries()) {
            expect(typeof stored.timestamp).toBe("string");
            expect(stored.timestamp.length).toBeGreaterThan(0);
            expect(Object.values(LogLevel)).toContain(stored.level);
            expect(typeof stored.category).toBe("string");
            expect(stored.category.length).toBeGreaterThan(0);
            expect(typeof stored.message).toBe("string");
            expect(stored.message.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2: emit then getEntries containment
  // Feature: frontend-header-responsive-logging, Property 2: emit then getEntries containment
  // Validates: Requirements 1.4, 1.6
  // -------------------------------------------------------------------------
  it("[property] Property 2: emit/getEntries containment", () => {
    // Feature: frontend-header-responsive-logging, Property 2: emit then getEntries containment
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          // Use a large window so no entries are dropped.
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });
          for (const e of entries) logger.emit(e);
          const stored = logger.getEntries();
          // Every emitted entry must appear in stored (by message + category + level).
          for (let i = 0; i < entries.length; i++) {
            expect(stored[i].message).toBe(entries[i].message);
            expect(stored[i].category).toBe(entries[i].category);
            expect(stored[i].level).toBe(entries[i].level);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 3: Window overflow drops entries and increments droppedCount
  // Feature: frontend-header-responsive-logging, Property 3: Window overflow drops entries and increments droppedCount
  // Validates: Requirements 1.5, 1.8, 6.4
  // -------------------------------------------------------------------------
  it("[property] Property 3: window overflow drops entries and increments droppedCount", () => {
    // Feature: frontend-header-responsive-logging, Property 3: Window overflow drops entries and increments droppedCount
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (n, k) => {
          const logger = makeLogger({
            maxEntriesPerCycle: n + k + 10,
            maxEntriesPerWindow: n,
            windowMs: 60000, // large window so it doesn't reset
          });
          const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: LogLevel.info,
            category: "test",
            message: "msg",
          };
          for (let i = 0; i < n + k; i++) logger.emit(entry);
          expect(logger.getEntries()).toHaveLength(n);
          expect(logger.getDroppedCount()).toBe(k);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 4: reset restores initial state
  // Feature: frontend-header-responsive-logging, Property 4: reset restores initial state
  // Validates: Requirements 1.7
  // -------------------------------------------------------------------------
  it("[property] Property 4: reset restores initial state", () => {
    // Feature: frontend-header-responsive-logging, Property 4: reset restores initial state
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 0, max: 10 }),
        (entries, extra) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow:
              entries.length > 0 ? Math.max(1, entries.length - extra) : 1,
            windowMs: 60000,
          });
          for (const e of entries) logger.emit(e);
          logger.reset();
          expect(logger.getEntries()).toHaveLength(0);
          expect(logger.getDroppedCount()).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// LogBound clamping — unit + property tests
// ---------------------------------------------------------------------------

describe("LogBound clamping", () => {
  it("[unit] default bound is applied when logBound prop is omitted", () => {
    expect(DEFAULT_LOG_BOUND.maxEntriesPerCycle).toBe(10);
    expect(DEFAULT_LOG_BOUND.maxEntriesPerWindow).toBe(100);
    expect(DEFAULT_LOG_BOUND.windowMs).toBe(1000);
  });

  it("[unit] valid bound passes through unchanged with no warn entries", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const bound: LogBound = {
      maxEntriesPerCycle: 5,
      maxEntriesPerWindow: 50,
      windowMs: 500,
    };
    const result = clampLogBound(bound, logger);
    expect(result).toEqual(bound);
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] maxEntriesPerCycle < 1 is clamped to 1 with warn", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const result = clampLogBound(
      { maxEntriesPerCycle: 0, maxEntriesPerWindow: 10, windowMs: 100 },
      logger,
    );
    expect(result.maxEntriesPerCycle).toBe(1);
    const warns = logger
      .getEntries()
      .filter((e) => e.level === LogLevel.warn && e.category === "config");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(
      warns.some(
        (e) =>
          (e.meta as Record<string, unknown>)["field"] === "maxEntriesPerCycle",
      ),
    ).toBe(true);
  });

  it("[unit] maxEntriesPerWindow < maxEntriesPerCycle is clamped with warn", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const result = clampLogBound(
      { maxEntriesPerCycle: 10, maxEntriesPerWindow: 5, windowMs: 100 },
      logger,
    );
    expect(result.maxEntriesPerWindow).toBe(10);
    const warns = logger
      .getEntries()
      .filter((e) => e.level === LogLevel.warn && e.category === "config");
    expect(
      warns.some(
        (e) =>
          (e.meta as Record<string, unknown>)["field"] ===
          "maxEntriesPerWindow",
      ),
    ).toBe(true);
  });

  it("[unit] windowMs < 1 is clamped to 1 with warn", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const result = clampLogBound(
      { maxEntriesPerCycle: 5, maxEntriesPerWindow: 50, windowMs: 0 },
      logger,
    );
    expect(result.windowMs).toBe(1);
    const warns = logger
      .getEntries()
      .filter((e) => e.level === LogLevel.warn && e.category === "config");
    expect(
      warns.some(
        (e) => (e.meta as Record<string, unknown>)["field"] === "windowMs",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Property 5: LogBound clamping emits warn entries
  // Feature: frontend-header-responsive-logging, Property 5: LogBound clamping emits warn entries
  // Validates: Requirements 2.2, 2.3, 2.4, 2.5
  // -------------------------------------------------------------------------
  it("[property] Property 5: LogBound clamping emits warn entries for each invalid field", () => {
    // Feature: frontend-header-responsive-logging, Property 5: LogBound clamping emits warn entries
    fc.assert(
      fc.property(
        // Generate a LogBound with fields that may be valid or invalid.
        fc.record({
          maxEntriesPerCycle: fc.integer({ min: -100, max: 10 }),
          maxEntriesPerWindow: fc.integer({ min: -100, max: 20 }),
          windowMs: fc.integer({ min: -100, max: 10 }),
        }),
        (rawBound) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });

          const result = clampLogBound(rawBound, logger);
          const warnEntries = logger
            .getEntries()
            .filter(
              (e) => e.level === LogLevel.warn && e.category === "config",
            );

          // --- maxEntriesPerCycle ---
          if (rawBound.maxEntriesPerCycle < 1) {
            expect(result.maxEntriesPerCycle).toBe(1);
            expect(
              warnEntries.some(
                (e) =>
                  (e.meta as Record<string, unknown>)["field"] ===
                  "maxEntriesPerCycle",
              ),
            ).toBe(true);
          } else {
            expect(result.maxEntriesPerCycle).toBe(rawBound.maxEntriesPerCycle);
          }

          // --- maxEntriesPerWindow (compared against the already-clamped cycle value) ---
          const clampedCycle = Math.max(rawBound.maxEntriesPerCycle, 1);
          if (rawBound.maxEntriesPerWindow < clampedCycle) {
            expect(result.maxEntriesPerWindow).toBe(clampedCycle);
            expect(
              warnEntries.some(
                (e) =>
                  (e.meta as Record<string, unknown>)["field"] ===
                  "maxEntriesPerWindow",
              ),
            ).toBe(true);
          } else {
            expect(result.maxEntriesPerWindow).toBe(
              rawBound.maxEntriesPerWindow,
            );
          }

          // --- windowMs ---
          if (rawBound.windowMs < 1) {
            expect(result.windowMs).toBe(1);
            expect(
              warnEntries.some(
                (e) =>
                  (e.meta as Record<string, unknown>)["field"] === "windowMs",
              ),
            ).toBe(true);
          } else {
            expect(result.windowMs).toBe(rawBound.windowMs);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Validation logging — BreakpointValidator
// ---------------------------------------------------------------------------

describe("Validation logging (BreakpointValidator)", () => {
  // -------------------------------------------------------------------------
  // Property 12: Validator error logging before throw
  // Feature: frontend-header-responsive-logging, Property 12: Validator error logging before throw
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
  // -------------------------------------------------------------------------
  it("[property] Property 12: validator error logging before throw", () => {
    // Feature: frontend-header-responsive-logging, Property 12: Validator error logging before throw

    // Arbitraries for invalid values (strings that are NOT in the valid sets)
    const validBreakpoints = [
      "mobile",
      "tablet",
      "desktop",
      "wide",
      "ultra-wide",
    ];
    const validLayoutModes = ["stacked", "inline", "overlay"];
    const validVisibilityStates = ["visible", "hidden", "collapsed"];

    // Generate strings that are guaranteed to be invalid for each validator
    const invalidBreakpointArb = fc
      .string({ minLength: 1, maxLength: 32 })
      .filter((s) => !validBreakpoints.includes(s));

    const invalidLayoutModeArb = fc
      .string({ minLength: 1, maxLength: 32 })
      .filter((s) => !validLayoutModes.includes(s));

    const invalidVisibilityArb = fc
      .string({ minLength: 1, maxLength: 32 })
      .filter((s) => !validVisibilityStates.includes(s));

    // Helper: checks whether a string is safe (only [A-Za-z0-9_-])
    const isSafe = (s: string) => /^[A-Za-z0-9_\-]*$/.test(s);

    fc.assert(
      fc.property(
        invalidBreakpointArb,
        invalidLayoutModeArb,
        invalidVisibilityArb,
        (invalidBp, invalidLm, invalidVs) => {
          // --- isValidBreakpoint ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            expect(() =>
              BreakpointValidator.isValidBreakpoint(invalidBp, logger),
            ).toThrow(FrontendHeaderResponsiveError);

            const entries = logger.getEntries();
            expect(entries).toHaveLength(1);
            const entry = entries[0];
            expect(entry.level).toBe(LogLevel.error);
            expect(entry.category).toBe("validation");
            expect(entry.meta).toBeDefined();
            const meta = entry.meta as Record<string, unknown>;
            expect(meta["field"]).toBe("breakpoint");
            expect(Array.isArray(meta["allowed"])).toBe(true);
            // received must be sanitised
            const expectedReceived = isSafe(invalidBp)
              ? invalidBp
              : "[REDACTED]";
            expect(meta["received"]).toBe(expectedReceived);
          }

          // --- isValidLayoutMode ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            expect(() =>
              BreakpointValidator.isValidLayoutMode(invalidLm, logger),
            ).toThrow(FrontendHeaderResponsiveError);

            const entries = logger.getEntries();
            expect(entries).toHaveLength(1);
            const entry = entries[0];
            expect(entry.level).toBe(LogLevel.error);
            expect(entry.category).toBe("validation");
            const meta = entry.meta as Record<string, unknown>;
            expect(meta["field"]).toBe("layoutMode");
            expect(Array.isArray(meta["allowed"])).toBe(true);
            const expectedReceived = isSafe(invalidLm)
              ? invalidLm
              : "[REDACTED]";
            expect(meta["received"]).toBe(expectedReceived);
          }

          // --- isValidVisibilityState ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            expect(() =>
              BreakpointValidator.isValidVisibilityState(invalidVs, logger),
            ).toThrow(FrontendHeaderResponsiveError);

            const entries = logger.getEntries();
            expect(entries).toHaveLength(1);
            const entry = entries[0];
            expect(entry.level).toBe(LogLevel.error);
            expect(entry.category).toBe("validation");
            const meta = entry.meta as Record<string, unknown>;
            expect(meta["field"]).toBe("visibilityState");
            expect(Array.isArray(meta["allowed"])).toBe(true);
            const expectedReceived = isSafe(invalidVs)
              ? invalidVs
              : "[REDACTED]";
            expect(meta["received"]).toBe(expectedReceived);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("[unit] isValidBreakpoint throws without logger when no logger provided", () => {
    expect(() => BreakpointValidator.isValidBreakpoint("invalid")).toThrow(
      FrontendHeaderResponsiveError,
    );
  });

  it("[unit] isValidBreakpoint returns true for valid values", () => {
    const logger = makeLogger();
    expect(BreakpointValidator.isValidBreakpoint("mobile", logger)).toBe(true);
    expect(BreakpointValidator.isValidBreakpoint("ultra-wide", logger)).toBe(
      true,
    );
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] isValidLayoutMode returns true for valid values", () => {
    const logger = makeLogger();
    expect(BreakpointValidator.isValidLayoutMode("stacked", logger)).toBe(true);
    expect(BreakpointValidator.isValidLayoutMode("overlay", logger)).toBe(true);
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] isValidVisibilityState returns true for valid values", () => {
    const logger = makeLogger();
    expect(BreakpointValidator.isValidVisibilityState("visible", logger)).toBe(
      true,
    );
    expect(
      BreakpointValidator.isValidVisibilityState("collapsed", logger),
    ).toBe(true);
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] received value with special chars is REDACTED in meta", () => {
    const logger = makeLogger();
    expect(() =>
      BreakpointValidator.isValidBreakpoint("<script>xss</script>", logger),
    ).toThrow(FrontendHeaderResponsiveError);
    const meta = logger.getEntries()[0].meta as Record<string, unknown>;
    expect(meta["received"]).toBe("[REDACTED]");
  });

  it("[unit] received value with only safe chars is preserved in meta", () => {
    const logger = makeLogger();
    expect(() =>
      BreakpointValidator.isValidBreakpoint("not-a-breakpoint", logger),
    ).toThrow(FrontendHeaderResponsiveError);
    const meta = logger.getEntries()[0].meta as Record<string, unknown>;
    expect(meta["received"]).toBe("not-a-breakpoint");
  });
});

// ---------------------------------------------------------------------------
// Breakpoint transition logging — updateBreakpoint
// ---------------------------------------------------------------------------

describe("Breakpoint transition logging (updateBreakpoint)", () => {
  // -------------------------------------------------------------------------
  // Property 6: Breakpoint transition logging
  // Feature: frontend-header-responsive-logging, Property 6: Breakpoint transition logging
  // Validates: Requirements 3.1, 3.2
  // -------------------------------------------------------------------------
  it("[property] Property 6: breakpoint transition logging", () => {
    // Feature: frontend-header-responsive-logging, Property 6: Breakpoint transition logging
    fc.assert(
      fc.property(
        // Generate a valid width in [1, 10000] to avoid warn entries.
        fc.integer({ min: 1, max: 10000 }),
        // Generate a previous breakpoint (or null for first call).
        fc.option(
          fc.constantFrom("mobile", "tablet", "desktop", "wide", "ultra-wide"),
          { nil: null },
        ),
        (width, previousBreakpoint) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });

          const resolved = updateBreakpoint(width, previousBreakpoint, logger);

          const entries = logger.getEntries();
          // Only one entry should be emitted (no warn since width is in range).
          expect(entries).toHaveLength(1);
          const entry = entries[0];

          expect(entry.category).toBe("breakpoint");
          const meta = entry.meta as Record<string, unknown>;

          if (previousBreakpoint !== resolved) {
            // Breakpoint changed → info entry with { from, to, width }
            expect(entry.level).toBe(LogLevel.info);
            expect(meta["from"]).toBe(previousBreakpoint);
            expect(meta["to"]).toBe(resolved);
            expect(meta["width"]).toBe(width);
          } else {
            // Breakpoint unchanged → debug entry with { current, width }
            expect(entry.level).toBe(LogLevel.debug);
            expect(meta["current"]).toBe(resolved);
            expect(meta["width"]).toBe(width);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 7: Invalid width bounds emit warn entries
  // Feature: frontend-header-responsive-logging, Property 7: Invalid width bounds emit warn entries
  // Validates: Requirements 3.3, 3.4
  // -------------------------------------------------------------------------
  it("[property] Property 7: invalid width bounds emit warn entries", () => {
    // Feature: frontend-header-responsive-logging, Property 7: Invalid width bounds emit warn entries
    fc.assert(
      fc.property(
        // Generate widths that are out of range: <= 0 or > 10000.
        fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 10001 })),
        (width) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });

          updateBreakpoint(width, null, logger);

          const entries = logger.getEntries();
          // At least one warn entry must be emitted.
          const warnEntries = entries.filter(
            (e) => e.level === LogLevel.warn && e.category === "breakpoint",
          );
          expect(warnEntries.length).toBeGreaterThanOrEqual(1);

          const warnEntry = warnEntries[0];
          const meta = warnEntry.meta as Record<string, unknown>;

          if (width <= 0) {
            // invalidWidth key must contain the offending width.
            expect(meta["invalidWidth"]).toBe(width);
          } else {
            // clampedWidth key must contain the offending width.
            expect(meta["clampedWidth"]).toBe(width);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Unit tests for concrete examples
  it("[unit] emits info on breakpoint change (mobile → tablet)", () => {
    const logger = makeLogger();
    const result = updateBreakpoint(600, "mobile", logger);
    expect(result).toBe("tablet");
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.info);
    expect(entries[0].category).toBe("breakpoint");
    const meta = entries[0].meta as Record<string, unknown>;
    expect(meta["from"]).toBe("mobile");
    expect(meta["to"]).toBe("tablet");
    expect(meta["width"]).toBe(600);
  });

  it("[unit] emits debug on no breakpoint change", () => {
    const logger = makeLogger();
    const result = updateBreakpoint(300, "mobile", logger);
    expect(result).toBe("mobile");
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.debug);
    const meta = entries[0].meta as Record<string, unknown>;
    expect(meta["current"]).toBe("mobile");
    expect(meta["width"]).toBe(300);
  });

  it("[unit] emits warn for width <= 0 (zero-width viewport)", () => {
    const logger = makeLogger();
    updateBreakpoint(0, null, logger);
    const warns = logger
      .getEntries()
      .filter((e) => e.level === LogLevel.warn && e.category === "breakpoint");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const meta = warns[0].meta as Record<string, unknown>;
    expect(meta["invalidWidth"]).toBe(0);
  });

  it("[unit] emits warn for width > 10000 (max-width viewport)", () => {
    const logger = makeLogger();
    updateBreakpoint(10001, null, logger);
    const warns = logger
      .getEntries()
      .filter((e) => e.level === LogLevel.warn && e.category === "breakpoint");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const meta = warns[0].meta as Record<string, unknown>;
    expect(meta["clampedWidth"]).toBe(10001);
  });

  it("[unit] does not include wallet address or network name in breakpoint entries", () => {
    const logger = makeLogger();
    updateBreakpoint(500, "mobile", logger);
    for (const entry of logger.getEntries()) {
      expect(entry.category).toBe("breakpoint");
      if (entry.meta) {
        const keys = Object.keys(entry.meta);
        expect(keys).not.toContain("walletAddress");
        expect(keys).not.toContain("networkName");
      }
    }
  });

  it("[unit] first call with null previous emits info entry", () => {
    const logger = makeLogger();
    const result = updateBreakpoint(300, null, logger);
    expect(result).toBe("mobile");
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.info);
    const meta = entries[0].meta as Record<string, unknown>;
    expect(meta["from"]).toBeNull();
    expect(meta["to"]).toBe("mobile");
  });
});

// ---------------------------------------------------------------------------
// Wallet logging — truncateWalletAddress, validateWalletAddress,
//                  resolveNetworkLabel, emitWalletStateChange
// ---------------------------------------------------------------------------

import {
  validateWalletAddress,
  emitWalletStateChange,
  WalletBadgeState,
} from "./frontend_header_responsive";
import {
  truncateWalletAddress,
  resolveNetworkLabel,
  SUPPORTED_NETWORKS,
} from "../utils/frontend_header_responsive";

describe("Wallet logging", () => {
  // -------------------------------------------------------------------------
  // Property 8: Raw wallet address never appears in any LogEntry
  // Feature: frontend-header-responsive-logging, Property 8: Raw wallet address never appears in any LogEntry
  // Validates: Requirements 4.2, 9.4
  // -------------------------------------------------------------------------
  it("[property] Property 8: raw wallet address never appears in any LogEntry", () => {
    // Feature: frontend-header-responsive-logging, Property 8: Raw wallet address never appears in any LogEntry
    fc.assert(
      fc.property(
        // Use minLength 8 to avoid trivial single-char/short strings that
        // appear naturally in log message text (e.g. spaces, single letters).
        fc.string({ minLength: 8, maxLength: 80 }),
        (address) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });

          validateWalletAddress(address, logger);

          for (const entry of logger.getEntries()) {
            // Raw address must not appear in message
            expect(entry.message).not.toContain(address);
            // No meta key named "walletAddress"
            if (entry.meta) {
              expect(Object.keys(entry.meta)).not.toContain("walletAddress");
              // Raw address must not appear in any meta value
              for (const val of Object.values(entry.meta)) {
                if (typeof val === "string") {
                  expect(val).not.toContain(address);
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 9: Valid wallet address truncated to displayAddress form
  // Feature: frontend-header-responsive-logging, Property 9: Valid wallet address truncated to displayAddress form
  // Validates: Requirements 4.3
  // -------------------------------------------------------------------------
  it("[property] Property 9: valid wallet address truncated to displayAddress form", () => {
    // Feature: frontend-header-responsive-logging, Property 9: Valid wallet address truncated to displayAddress form

    // Generate valid 56-char Stellar base32 addresses
    const stellarBase32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const validAddressArb = fc
      .array(fc.integer({ min: 0, max: stellarBase32Chars.length - 1 }), {
        minLength: 56,
        maxLength: 56,
      })
      .map((indices) => indices.map((i) => stellarBase32Chars[i]).join(""));

    fc.assert(
      fc.property(validAddressArb, (address) => {
        const logger = makeLogger({
          maxEntriesPerCycle: 1000,
          maxEntriesPerWindow: 1000,
          windowMs: 60000,
        });

        const displayAddress = validateWalletAddress(address, logger);

        // No warn entries should be emitted for a valid address
        expect(logger.getEntries()).toHaveLength(0);

        // displayAddress must be "G..." + last 4 chars
        expect(displayAddress).toBe("G..." + address.slice(-4));

        // Also verify truncateWalletAddress directly
        expect(truncateWalletAddress(address)).toBe("G..." + address.slice(-4));
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 10: Wallet state change logging
  // Feature: frontend-header-responsive-logging, Property 10: Wallet state change logging
  // Validates: Requirements 4.1
  // -------------------------------------------------------------------------
  it("[property] Property 10: wallet state change logging", () => {
    // Feature: frontend-header-responsive-logging, Property 10: Wallet state change logging

    const walletStateArb = fc.constantFrom<WalletBadgeState>(
      "pending",
      "connecting",
      "connected",
      "disconnected",
    );

    fc.assert(
      fc.property(walletStateArb, walletStateArb, (from, to) => {
        // Only test distinct state pairs (transitions)
        fc.pre(from !== to);

        const logger = makeLogger({
          maxEntriesPerCycle: 1000,
          maxEntriesPerWindow: 1000,
          windowMs: 60000,
        });

        emitWalletStateChange(from, to, null, logger);

        const entries = logger.getEntries();
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.level).toBe(LogLevel.info);
        expect(entry.category).toBe("wallet");
        expect(entry.meta).toBeDefined();
        const meta = entry.meta as Record<string, unknown>;
        expect(meta["from"]).toBe(from);
        expect(meta["to"]).toBe(to);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 11: Invalid wallet address and unknown network emit warn entries
  // Feature: frontend-header-responsive-logging, Property 11: Invalid wallet address and unknown network emit warn entries
  // Validates: Requirements 4.4, 4.5
  // -------------------------------------------------------------------------
  it("[property] Property 11: invalid address and unknown network emit warn entries", () => {
    // Feature: frontend-header-responsive-logging, Property 11: Invalid wallet address and unknown network emit warn entries

    // Generate addresses with wrong length (not 56 chars) but valid base32 chars
    const stellarBase32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const invalidLengthAddressArb = fc
      .integer({ min: 1, max: 100 })
      .filter((len) => len !== 56)
      .chain((len) =>
        fc
          .array(fc.integer({ min: 0, max: stellarBase32Chars.length - 1 }), {
            minLength: len,
            maxLength: len,
          })
          .map((indices) => indices.map((i) => stellarBase32Chars[i]).join("")),
      );

    // Generate network names not in SUPPORTED_NETWORKS (min length 4 to avoid
    // trivial single-char matches in reason strings like "unknown_network")
    const unknownNetworkArb = fc
      .stringMatching(/^[a-z\-]{4,}$/)
      .filter((n) => !(SUPPORTED_NETWORKS as readonly string[]).includes(n));

    fc.assert(
      fc.property(
        invalidLengthAddressArb,
        unknownNetworkArb,
        (address, network) => {
          // --- Invalid address length ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            const result = validateWalletAddress(address, logger);
            expect(result).toBeNull();

            const warnEntries = logger
              .getEntries()
              .filter((e) => e.level === LogLevel.warn);
            expect(warnEntries.length).toBeGreaterThanOrEqual(1);

            const lengthWarn = warnEntries.find(
              (e) =>
                (e.meta as Record<string, unknown>)["reason"] ===
                "invalid_address_length",
            );
            expect(lengthWarn).toBeDefined();
            const meta = lengthWarn!.meta as Record<string, unknown>;
            expect(meta["length"]).toBe(address.length);
            // Raw address must not appear in meta values (message is generic)
            for (const val of Object.values(meta)) {
              if (typeof val === "string") {
                expect(val).not.toContain(address);
              }
            }
          }

          // --- Unknown network ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            const result = resolveNetworkLabel(network, logger);
            expect(result).toBe("unknown");

            const warnEntries = logger
              .getEntries()
              .filter((e) => e.level === LogLevel.warn);
            expect(warnEntries.length).toBeGreaterThanOrEqual(1);

            const networkWarn = warnEntries.find(
              (e) =>
                (e.meta as Record<string, unknown>)["reason"] ===
                "unknown_network",
            );
            expect(networkWarn).toBeDefined();
            // Raw network name must not appear in meta values (message is generic)
            if (networkWarn!.meta) {
              for (const val of Object.values(networkWarn!.meta)) {
                if (typeof val === "string") {
                  expect(val).not.toContain(network);
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 15: Security — Stellar base32 and networkName allowlist
  // Feature: frontend-header-responsive-logging, Property 15: Security — Stellar base32 and networkName allowlist
  // Validates: Requirements 9.1, 9.2
  // -------------------------------------------------------------------------
  it("[property] Property 15: security allowlist validation", () => {
    // Feature: frontend-header-responsive-logging, Property 15: Security — Stellar base32 and networkName allowlist

    // Generate wallet addresses with at least one disallowed character
    const disallowedWalletArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc
          .string({ minLength: 1, maxLength: 5 })
          .filter((s) => /[^A-Z2-7]/.test(s)),
        fc.integer({ min: 0, max: 79 }),
      )
      .map(([base, disallowed, pos]) => {
        const insertAt = Math.min(pos, base.length);
        return base.slice(0, insertAt) + disallowed + base.slice(insertAt);
      })
      .filter((s) => /[^A-Z2-7]/.test(s));

    // Generate network names with at least one disallowed character
    const disallowedNetworkArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc
          .string({ minLength: 1, maxLength: 3 })
          .filter((s) => /[^a-z\-]/.test(s)),
        fc.integer({ min: 0, max: 19 }),
      )
      .map(([base, disallowed, pos]) => {
        const insertAt = Math.min(pos, base.length);
        return base.slice(0, insertAt) + disallowed + base.slice(insertAt);
      })
      .filter((s) => /[^a-z\-]/.test(s));

    fc.assert(
      fc.property(
        disallowedWalletArb,
        disallowedNetworkArb,
        (address, network) => {
          // --- Wallet address with disallowed characters ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            const result = validateWalletAddress(address, logger);
            // Must be treated as invalid (absent)
            expect(result).toBeNull();

            const securityWarns = logger
              .getEntries()
              .filter(
                (e) => e.level === LogLevel.warn && e.category === "security",
              );
            expect(securityWarns.length).toBeGreaterThanOrEqual(1);
            // Raw address must not appear in any entry
            for (const entry of logger.getEntries()) {
              expect(entry.message).not.toContain(address);
              if (entry.meta) {
                for (const val of Object.values(entry.meta)) {
                  if (typeof val === "string") {
                    expect(val).not.toContain(address);
                  }
                }
              }
            }
          }

          // --- Network name with disallowed characters ---
          {
            const logger = makeLogger({
              maxEntriesPerCycle: 1000,
              maxEntriesPerWindow: 1000,
              windowMs: 60000,
            });
            const result = resolveNetworkLabel(network, logger);
            // Must be treated as unknown
            expect(result).toBe("unknown");

            const securityWarns = logger
              .getEntries()
              .filter(
                (e) => e.level === LogLevel.warn && e.category === "security",
              );
            expect(securityWarns.length).toBeGreaterThanOrEqual(1);
            // Raw network name must not appear in any entry
            for (const entry of logger.getEntries()) {
              expect(entry.message).not.toContain(network);
              if (entry.meta) {
                for (const val of Object.values(entry.meta)) {
                  if (typeof val === "string") {
                    expect(val).not.toContain(network);
                  }
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Unit tests for wallet logging
  it("[unit] truncateWalletAddress returns G... + last 4 chars", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX";
    expect(truncateWalletAddress(addr)).toBe("G..." + addr.slice(-4));
  });

  it("[unit] validateWalletAddress returns null for address with disallowed chars", () => {
    const logger = makeLogger();
    const result = validateWalletAddress("GABC!DEF", logger);
    expect(result).toBeNull();
    const secWarn = logger
      .getEntries()
      .find((e) => e.level === LogLevel.warn && e.category === "security");
    expect(secWarn).toBeDefined();
  });

  it("[unit] validateWalletAddress returns null for wrong-length address", () => {
    const logger = makeLogger();
    const result = validateWalletAddress("GABCDE", logger);
    expect(result).toBeNull();
    const walletWarn = logger
      .getEntries()
      .find(
        (e) =>
          e.level === LogLevel.warn &&
          e.category === "wallet" &&
          (e.meta as Record<string, unknown>)["reason"] ===
            "invalid_address_length",
      );
    expect(walletWarn).toBeDefined();
    expect((walletWarn!.meta as Record<string, unknown>)["length"]).toBe(6);
  });

  it("[unit] validateWalletAddress returns displayAddress for valid 56-char address", () => {
    const logger = makeLogger();
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    // Ensure exactly 56 chars
    const validAddr = addr
      .padEnd(56, "A")
      .slice(0, 56)
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, "A");
    const result = validateWalletAddress(validAddr, logger);
    expect(result).toBe("G..." + validAddr.slice(-4));
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] resolveNetworkLabel returns network for valid supported network", () => {
    const logger = makeLogger();
    expect(resolveNetworkLabel("mainnet", logger)).toBe("mainnet");
    expect(resolveNetworkLabel("testnet", logger)).toBe("testnet");
    expect(resolveNetworkLabel("futurenet", logger)).toBe("futurenet");
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("[unit] resolveNetworkLabel returns unknown for unsupported network", () => {
    const logger = makeLogger();
    const result = resolveNetworkLabel("devnet", logger);
    expect(result).toBe("unknown");
    const warn = logger
      .getEntries()
      .find(
        (e) =>
          e.level === LogLevel.warn &&
          (e.meta as Record<string, unknown>)["reason"] === "unknown_network",
      );
    expect(warn).toBeDefined();
    // Raw network name must not appear in the entry
    expect(warn!.message).not.toContain("devnet");
  });

  it("[unit] resolveNetworkLabel returns unknown for network with disallowed chars (HTML injection)", () => {
    const logger = makeLogger();
    const result = resolveNetworkLabel("<script>alert(1)</script>", logger);
    expect(result).toBe("unknown");
    const secWarn = logger
      .getEntries()
      .find((e) => e.level === LogLevel.warn && e.category === "security");
    expect(secWarn).toBeDefined();
  });

  it("[unit] emitWalletStateChange emits info entry with from/to", () => {
    const logger = makeLogger();
    emitWalletStateChange("pending", "connecting", null, logger);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.info);
    expect(entries[0].category).toBe("wallet");
    const meta = entries[0].meta as Record<string, unknown>;
    expect(meta["from"]).toBe("pending");
    expect(meta["to"]).toBe("connecting");
    expect(meta["displayAddress"]).toBeUndefined();
  });

  it("[unit] emitWalletStateChange includes displayAddress when provided", () => {
    const logger = makeLogger();
    emitWalletStateChange("connecting", "connected", "G...WXYZ", logger);
    const meta = logger.getEntries()[0].meta as Record<string, unknown>;
    expect(meta["displayAddress"]).toBe("G...WXYZ");
    // No raw address key
    expect(Object.keys(meta)).not.toContain("walletAddress");
  });

  it("[unit] all four WalletBadgeState transitions are logged correctly", () => {
    const states: WalletBadgeState[] = [
      "pending",
      "connecting",
      "connected",
      "disconnected",
    ];
    for (let i = 0; i < states.length - 1; i++) {
      const logger = makeLogger();
      emitWalletStateChange(states[i], states[i + 1], null, logger);
      const entry = logger.getEntries()[0];
      expect(entry.level).toBe(LogLevel.info);
      expect(entry.category).toBe("wallet");
      const meta = entry.meta as Record<string, unknown>;
      expect(meta["from"]).toBe(states[i]);
      expect(meta["to"]).toBe(states[i + 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Security — raw wallet address never in LogEntries (unit tests)
// ---------------------------------------------------------------------------

describe("Security — raw wallet address never in LogEntries", () => {
  it("[unit] raw address never appears in message or meta for disallowed-char address", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const rawAddress = "GABC!DEF<script>xss</script>HIJKLMNOPQRSTUVWXYZ234567";
    validateWalletAddress(rawAddress, logger);
    for (const entry of logger.getEntries()) {
      expect(entry.message).not.toContain(rawAddress);
      expect(Object.keys(entry.meta ?? {})).not.toContain("walletAddress");
      for (const val of Object.values(entry.meta ?? {})) {
        if (typeof val === "string") {
          expect(val).not.toContain(rawAddress);
        }
      }
    }
  });

  it("[unit] raw address never appears in message or meta for wrong-length address", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const rawAddress = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // 32 chars, not 56
    validateWalletAddress(rawAddress, logger);
    for (const entry of logger.getEntries()) {
      expect(entry.message).not.toContain(rawAddress);
      expect(Object.keys(entry.meta ?? {})).not.toContain("walletAddress");
      for (const val of Object.values(entry.meta ?? {})) {
        if (typeof val === "string") {
          expect(val).not.toContain(rawAddress);
        }
      }
    }
  });

  it("[unit] no meta key named walletAddress is ever emitted", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    // Valid address — emits no entries, but verify no walletAddress key
    const validAddr =
      "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    validateWalletAddress(validAddr, logger);
    // Wallet state change — verify no walletAddress key
    emitWalletStateChange("pending", "connected", "G...UVWX", logger);
    for (const entry of logger.getEntries()) {
      expect(Object.keys(entry.meta ?? {})).not.toContain("walletAddress");
    }
  });

  it("[unit] displayAddress in meta is truncated form, not raw address", () => {
    const logger = makeLogger({
      maxEntriesPerCycle: 1000,
      maxEntriesPerWindow: 1000,
      windowMs: 60000,
    });
    const rawAddress =
      "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    const displayAddress = validateWalletAddress(rawAddress, logger);
    expect(displayAddress).toBe("G..." + rawAddress.slice(-4));
    emitWalletStateChange("pending", "connected", displayAddress, logger);
    const walletEntry = logger
      .getEntries()
      .find((e) => e.category === "wallet");
    expect(walletEntry).toBeDefined();
    const meta = walletEntry!.meta as Record<string, unknown>;
    // displayAddress is the truncated form, not the raw address
    expect(meta["displayAddress"]).toBe("G..." + rawAddress.slice(-4));
    expect(meta["displayAddress"]).not.toBe(rawAddress);
    expect(Object.keys(meta)).not.toContain("walletAddress");
  });
});

// ---------------------------------------------------------------------------
// Menu toggle logging — handleToggleMenu
// ---------------------------------------------------------------------------

import { handleToggleMenu } from "./frontend_header_responsive";

describe("Menu toggle logging (handleToggleMenu)", () => {
  // -------------------------------------------------------------------------
  // Property 13: Menu toggle logging
  // Feature: frontend-header-responsive-logging, Property 13: Menu toggle logging
  // Validates: Requirements 6.1, 6.2, 6.3
  // -------------------------------------------------------------------------
  it("[property] Property 13: menu toggle logging", () => {
    // Feature: frontend-header-responsive-logging, Property 13: Menu toggle logging
    fc.assert(
      fc.property(
        // currentState: any boolean
        fc.boolean(),
        // onToggleMenu: either a callback or undefined
        fc.option(
          fc.constant((isOpen: boolean) => {
            void isOpen;
          }),
          { nil: undefined },
        ),
        (currentState, onToggleMenu) => {
          const logger = makeLogger({
            maxEntriesPerCycle: 1000,
            maxEntriesPerWindow: 1000,
            windowMs: 60000,
          });

          const newState = handleToggleMenu(currentState, onToggleMenu, logger);

          // The returned state must be the toggled value
          expect(newState).toBe(!currentState);

          const entries = logger.getEntries();

          // Must have exactly 2 entries: one info + one debug
          expect(entries).toHaveLength(2);

          // --- info entry (Requirement 6.1) ---
          const infoEntry = entries.find((e) => e.level === LogLevel.info);
          expect(infoEntry).toBeDefined();
          expect(infoEntry!.category).toBe("menu");
          expect(infoEntry!.meta).toBeDefined();
          const infoMeta = infoEntry!.meta as Record<string, unknown>;
          expect(infoMeta["newState"]).toBe(newState);

          // --- debug entry (Requirements 6.2 / 6.3) ---
          const debugEntry = entries.find((e) => e.level === LogLevel.debug);
          expect(debugEntry).toBeDefined();
          expect(debugEntry!.category).toBe("menu");
          expect(debugEntry!.meta).toBeDefined();
          const debugMeta = debugEntry!.meta as Record<string, unknown>;

          if (onToggleMenu !== undefined) {
            // Callback provided → callbackFired: true, newState present (Requirement 6.2)
            expect(debugMeta["callbackFired"]).toBe(true);
            expect(debugMeta["newState"]).toBe(newState);
          } else {
            // No callback → callbackFired: false (Requirement 6.3)
            expect(debugMeta["callbackFired"]).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("[unit] handleToggleMenu toggles false → true and emits info + debug entries", () => {
    const logger = makeLogger();
    const newState = handleToggleMenu(false, undefined, logger);
    expect(newState).toBe(true);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    const info = entries.find((e) => e.level === LogLevel.info)!;
    expect(info.category).toBe("menu");
    expect((info.meta as Record<string, unknown>)["newState"]).toBe(true);
    const debug = entries.find((e) => e.level === LogLevel.debug)!;
    expect((debug.meta as Record<string, unknown>)["callbackFired"]).toBe(
      false,
    );
  });

  it("[unit] handleToggleMenu toggles true → false and emits info + debug entries", () => {
    const logger = makeLogger();
    const newState = handleToggleMenu(true, undefined, logger);
    expect(newState).toBe(false);
    const info = logger.getEntries().find((e) => e.level === LogLevel.info)!;
    expect((info.meta as Record<string, unknown>)["newState"]).toBe(false);
  });

  it("[unit] handleToggleMenu fires callback and emits callbackFired: true", () => {
    const logger = makeLogger();
    let callbackArg: boolean | undefined;
    const cb = (isOpen: boolean) => {
      callbackArg = isOpen;
    };
    const newState = handleToggleMenu(false, cb, logger);
    expect(newState).toBe(true);
    expect(callbackArg).toBe(true);
    const debug = logger.getEntries().find((e) => e.level === LogLevel.debug)!;
    const meta = debug.meta as Record<string, unknown>;
    expect(meta["callbackFired"]).toBe(true);
    expect(meta["newState"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Serialisation — LogEntry JSON round-trip
// ---------------------------------------------------------------------------

describe("Serialisation", () => {
  // -------------------------------------------------------------------------
  // Property 14: LogEntry JSON round-trip
  // Feature: frontend-header-responsive-logging, Property 14: LogEntry JSON round-trip
  // Validates: Requirements 7.1, 7.2, 7.3, 7.4
  // -------------------------------------------------------------------------
  it("[property] Property 14: LogEntry JSON round-trip", () => {
    // Feature: frontend-header-responsive-logging, Property 14: LogEntry JSON round-trip

    // Arbitrary for JSON-serialisable meta values only
    const jsonMetaValueArb = fc.oneof(
      fc.string({ maxLength: 64 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    );

    const jsonMetaArb = fc.option(
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 16 }),
        jsonMetaValueArb,
      ),
      { nil: undefined },
    );

    const roundTripEntryArb: fc.Arbitrary<LogEntry> = fc.record({
      timestamp: isoTimestampArb,
      level: logLevelArb,
      category: fc.string({ minLength: 1, maxLength: 32 }),
      message: fc.string({ minLength: 1, maxLength: 128 }),
      meta: jsonMetaArb,
    });

    fc.assert(
      fc.property(roundTripEntryArb, (entry) => {
        const logger = makeLogger({
          maxEntriesPerCycle: 1000,
          maxEntriesPerWindow: 1000,
          windowMs: 60000,
        });

        logger.emit(entry);
        const stored = logger.getEntries()[0];

        // 7.1: JSON.parse(JSON.stringify(entry)) must be deeply equal to the original
        const roundTripped = JSON.parse(JSON.stringify(stored)) as LogEntry;
        expect(roundTripped.timestamp).toBe(stored.timestamp);
        expect(roundTripped.level).toBe(stored.level);
        expect(roundTripped.category).toBe(stored.category);
        expect(roundTripped.message).toBe(stored.message);
        if (stored.meta !== undefined) {
          expect(roundTripped.meta).toEqual(stored.meta);
        }

        // 7.2: timestamp survives round-trip through new Date().toISOString()
        expect(new Date(stored.timestamp).toISOString()).toBe(stored.timestamp);

        // 7.4: idempotent serialisation — serialise → deserialise → serialise
        //      must equal serialise → deserialise → serialise → deserialise → serialise
        const once = JSON.stringify(JSON.parse(JSON.stringify(stored)));
        const twice = JSON.stringify(
          JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(stored)))),
        );
        expect(once).toBe(twice);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Security — HTML sanitisation in meta
// ---------------------------------------------------------------------------

describe("Security — HTML sanitisation", () => {
  // -------------------------------------------------------------------------
  // Property 16: HTML sanitisation in meta
  // Feature: frontend-header-responsive-logging, Property 16: HTML sanitisation in meta
  // Validates: Requirements 9.3
  // -------------------------------------------------------------------------
  it("[property] Property 16: HTML sanitisation in meta", () => {
    // Feature: frontend-header-responsive-logging, Property 16: HTML sanitisation in meta

    // Generate a meta value string that contains at least one HTML tag
    const htmlTagArb = fc.constantFrom(
      "<script>",
      "<img src=x>",
      "<div>",
      "<span class='x'>",
      "<a href='#'>",
      "</script>",
      "</div>",
      "<br/>",
      "<input type='text'>",
    );

    // Build a string that contains an HTML tag somewhere inside it
    const stringWithHtmlArb = fc
      .tuple(
        fc.string({ maxLength: 20 }),
        htmlTagArb,
        fc.string({ maxLength: 20 }),
      )
      .map(([prefix, tag, suffix]) => prefix + tag + suffix);

    // Build a meta record with at least one string value containing an HTML tag
    const metaWithHtmlArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 16 }), // key
        stringWithHtmlArb, // value with HTML
      )
      .map(([key, value]) => ({ [key]: value }));

    fc.assert(
      fc.property(metaWithHtmlArb, (meta) => {
        const logger = makeLogger({
          maxEntriesPerCycle: 1000,
          maxEntriesPerWindow: 1000,
          windowMs: 60000,
        });

        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          level: LogLevel.info,
          category: "test",
          message: "html sanitisation test",
          meta,
        };

        logger.emit(entry);
        const stored = logger.getEntries()[0];

        // All string values in stored.meta must not contain any HTML tag substrings
        if (stored.meta) {
          for (const val of Object.values(stored.meta)) {
            if (typeof val === "string") {
              // Must not contain any HTML tag pattern
              expect(val).not.toMatch(/<[^>]+>/);
              // Must contain [REDACTED_HTML] where the tag was
              expect(val).toContain("[REDACTED_HTML]");
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
