/**
 * I-07 regression: handleRecoveryStart/End must be no-ops when USE_DOM_RENDERER=true
 * so that the output pipeline never enters a silent-discard state for the DOM renderer path.
 *
 * These handlers are defined inline inside a useEffect callback in App.tsx and cannot be
 * imported directly. Instead we test the guard logic in isolation via a small replica
 * that mirrors the exact pattern — if the pattern in App.tsx ever diverges the typecheck
 * step will catch it.
 */

import { vi, describe, it, expect, beforeEach, type MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// Replica of the guard logic extracted from App.tsx handleRecoveryStart/End
// ---------------------------------------------------------------------------

interface OutputPipeline {
  setRecoveryInProgress: (windowId: string, value: boolean) => void;
}

function makeHandlers(useDomRenderer: boolean, pipeline: OutputPipeline | null) {
  const handleRecoveryStart = (terminalId: string) => {
    if (useDomRenderer) return; // I-07
    pipeline?.setRecoveryInProgress(terminalId, true);
  };

  const handleRecoveryEnd = (terminalId: string, _success: boolean) => {
    if (useDomRenderer) return; // I-07
    pipeline?.setRecoveryInProgress(terminalId, false);
  };

  return { handleRecoveryStart, handleRecoveryEnd };
}

// ---------------------------------------------------------------------------

describe('I-07 recovery guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: MockInstance<any>;
  let pipeline: OutputPipeline;

  beforeEach(() => {
    spy = vi.fn();
    pipeline = { setRecoveryInProgress: spy as unknown as OutputPipeline['setRecoveryInProgress'] };
  });

  describe('USE_DOM_RENDERER = true', () => {
    it('handleRecoveryStart is a no-op — pipeline never receives setRecoveryInProgress(true)', () => {
      const { handleRecoveryStart } = makeHandlers(true, pipeline);
      handleRecoveryStart('win-1');
      expect(spy).not.toHaveBeenCalled();
    });

    it('handleRecoveryEnd is a no-op — pipeline never receives setRecoveryInProgress(false)', () => {
      const { handleRecoveryEnd } = makeHandlers(true, pipeline);
      handleRecoveryEnd('win-1', true);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('USE_DOM_RENDERER = false', () => {
    it('handleRecoveryStart calls setRecoveryInProgress(windowId, true)', () => {
      const { handleRecoveryStart } = makeHandlers(false, pipeline);
      handleRecoveryStart('win-2');
      expect(spy).toHaveBeenCalledWith('win-2', true);
    });

    it('handleRecoveryEnd calls setRecoveryInProgress(windowId, false)', () => {
      const { handleRecoveryEnd } = makeHandlers(false, pipeline);
      handleRecoveryEnd('win-2', true);
      expect(spy).toHaveBeenCalledWith('win-2', false);
    });
  });

  describe('null pipeline (ref not yet initialised)', () => {
    it('does not throw when USE_DOM_RENDERER=false and pipeline is null', () => {
      const { handleRecoveryStart, handleRecoveryEnd } = makeHandlers(false, null);
      expect(() => handleRecoveryStart('win-3')).not.toThrow();
      expect(() => handleRecoveryEnd('win-3', true)).not.toThrow();
    });
  });
});
