import React, { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @notice All supported visual/interaction states.
 * @dev Allowed transitions:
 *   idle        → submitting | disabled
 *   submitting  → success | error | disabled
 *   success     → idle | disabled
 *   error       → idle | submitting | disabled
 *   disabled    → idle
 */
export type SubmitButtonState = "idle" | "submitting" | "success" | "error" | "disabled";

/**
 * @notice Optional per-state label overrides.
 * @dev Values are normalized: non-strings, empty strings, and control characters are rejected.
 */
export interface SubmitButtonLabels {
  idle?: string;
  submitting?: string;
  success?: string;
  error?: string;
  disabled?: string;
}

/**
 * @notice Props accepted by ReactSubmitButton.
 */
export interface ReactSubmitButtonProps {
  state: SubmitButtonState;
  previousState?: SubmitButtonState;
  strictTransitions?: boolean;
  labels?: SubmitButtonLabels;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  className?: string;
  id?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LABEL_LENGTH = 80;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/g;

const DEFAULT_LABELS: Required<SubmitButtonLabels> = {
  idle: "Submit",
  submitting: "Submitting...",
  success: "Submitted",
  error: "Try Again",
  disabled: "Submit Disabled",
};

/**
 * @notice Allowed state transitions.
 */
export const ALLOWED_TRANSITIONS: Record<SubmitButtonState, SubmitButtonState[]> = {
  idle: ["submitting", "disabled"],
  submitting: ["success", "error", "disabled"],
  success: ["idle", "disabled"],
  error: ["idle", "submitting", "disabled"],
  disabled: ["idle"],
};

const BASE_STYLE: React.CSSProperties = {
  minHeight: "44px",
  minWidth: "120px",
  borderRadius: "8px",
  border: "1px solid #4f46e5",
  padding: "0.5rem 1rem",
  color: "#ffffff",
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.2s ease",
  backgroundColor: "#4f46e5",
};

const STATE_STYLES: Record<SubmitButtonState, React.CSSProperties> = {
  idle: { backgroundColor: "#4f46e5" },
  submitting: { backgroundColor: "#6366f1" },
  success: { backgroundColor: "#16a34a", borderColor: "#15803d" },
  error: { backgroundColor: "#dc2626", borderColor: "#b91c1c" },
  disabled: { backgroundColor: "#9ca3af", borderColor: "#9ca3af", cursor: "not-allowed", opacity: 0.9 },
};

// ── Pure helpers (exported for unit testing) ──────────────────────────────────

/**
 * @notice Sanitizes a candidate label: rejects non-strings, strips control characters,
 *         normalizes whitespace, and truncates to MAX_LABEL_LENGTH.
 * @param candidate  Untrusted input (may be any type).
 * @param fallback   Returned when candidate is unusable.
 * @security Prevents blank CTA states and layout-abuse via oversized labels.
 */
export function normalizeSubmitButtonLabel(candidate: unknown, fallback: string): string {
  if (typeof candidate !== "string") return fallback;
  const cleaned = candidate.replace(CONTROL_CHAR_RE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_LABEL_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_LABEL_LENGTH - 3)}...`;
}

/**
 * @notice Returns a safe, non-empty label for the given state.
 */
export function resolveSubmitButtonLabel(
  state: SubmitButtonState,
  labels?: SubmitButtonLabels,
): string {
  return normalizeSubmitButtonLabel(labels?.[state], DEFAULT_LABELS[state]);
}

/**
 * @notice Returns true when moving from `from` to `to` is an allowed transition.
 * @dev Same-state updates are always allowed (idempotent).
 */
export function isValidSubmitButtonStateTransition(
  from: SubmitButtonState,
  to: SubmitButtonState,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * @notice In strict mode, falls back to `previousState` when the transition is invalid.
 */
export function resolveSafeSubmitButtonState(
  state: SubmitButtonState,
  previousState?: SubmitButtonState,
  strictTransitions = true,
): SubmitButtonState {
  if (!strictTransitions || !previousState) return state;
  return isValidSubmitButtonStateTransition(previousState, state) ? state : previousState;
}

/**
 * @notice Returns true when the button must not respond to clicks.
 * @security Prevents duplicate blockchain transactions on rapid clicks.
 */
export function isSubmitButtonInteractionBlocked(
  state: SubmitButtonState,
  disabled = false,
  isLocallySubmitting = false,
): boolean {
  return Boolean(disabled) || state === "disabled" || state === "submitting" || isLocallySubmitting;
}

/**
 * @notice Returns true when aria-busy should be set (active submission in progress).
 */
export function isSubmitButtonBusy(
  state: SubmitButtonState,
  isLocallySubmitting = false,
): boolean {
  return state === "submitting" || isLocallySubmitting;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * @notice Reusable submit button with strict state machine, safe labels,
 *         double-submit prevention, and ARIA accessibility.
 */
const ReactSubmitButton = ({
  state,
  previousState,
  strictTransitions = true,
  labels,
  onClick,
  className,
  id,
  type = "button",
  disabled,
}: ReactSubmitButtonProps) => {
  const [isLocallySubmitting, setIsLocallySubmitting] = useState(false);

  const resolvedState = resolveSafeSubmitButtonState(state, previousState, strictTransitions);
  const label = resolveSubmitButtonLabel(resolvedState, labels);
  const blocked = isSubmitButtonInteractionBlocked(resolvedState, disabled, isLocallySubmitting);
  const ariaBusy = isSubmitButtonBusy(resolvedState, isLocallySubmitting);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (blocked || !onClick) return;
    setIsLocallySubmitting(true);
    try {
      await Promise.resolve(onClick(event));
    } catch {
      // Errors are the caller's responsibility; we only reset local state.
    } finally {
      setIsLocallySubmitting(false);
    }
  };

  return (
    <button
      id={id}
      type={type}
      className={className}
      disabled={blocked}
      aria-busy={ariaBusy}
      aria-live="polite"
      aria-label={label}
      data-state={resolvedState}
      onClick={blocked ? undefined : handleClick}
      style={{ ...BASE_STYLE, ...STATE_STYLES[resolvedState] }}
    >
      {label}
    </button>
  );
};

export default ReactSubmitButton;
