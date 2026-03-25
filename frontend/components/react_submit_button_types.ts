/**
 * @title SubmitButton — Types and State Configuration
 * @notice Pure TypeScript exports with no React dependency.
 *         Imported by both the component and the test suite.
 *
 * @security All colour values are hardcoded constants — no dynamic CSS injection.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @notice All possible visual/interaction states of the submit button.
 * @dev State transitions: idle → loading → success | error → idle (auto-reset)
 */
export type ButtonState = "idle" | "loading" | "success" | "error" | "disabled";

/**
 * @notice Props accepted by the SubmitButton component.
 * @dev `style` is typed as a plain object to avoid importing React here.
 */
export interface SubmitButtonProps {
  /** Text shown in the idle state. */
  label: string;
  /** Called when the button is clicked in the idle state. Must return a Promise. */
  onClick: () => Promise<void>;
  /** Externally controlled disabled flag (maps to the `disabled` state). */
  disabled?: boolean;
  /** Milliseconds before auto-resetting from success/error back to idle. Default: 2500. */
  resetDelay?: number;
  /** Override the button's HTML type attribute. Default: "submit". */
  type?: "submit" | "button" | "reset";
  /** Additional inline styles merged onto the button element. */
  style?: Record<string, string | number>;
  /** Optional test id for targeting in tests. */
  "data-testid"?: string;
}

// ── State configuration ───────────────────────────────────────────────────────

/**
 * @notice Visual configuration for each button state.
 * @dev Centralising colours here makes security review straightforward —
 *      no dynamic style injection from user input.
 */
export const STATE_CONFIG: Record<
  ButtonState,
  { label: string; backgroundColor: string; cursor: string; ariaLabel: string }
> = {
  idle: {
    label: "",
    backgroundColor: "#4f46e5",
    cursor: "pointer",
    ariaLabel: "",
  },
  loading: {
    label: "Processing\u2026",
    backgroundColor: "#6366f1",
    cursor: "not-allowed",
    ariaLabel: "Processing, please wait",
  },
  success: {
    label: "Success \u2713",
    backgroundColor: "#16a34a",
    cursor: "default",
    ariaLabel: "Action completed successfully",
  },
  error: {
    label: "Failed \u2014 retry",
    backgroundColor: "#dc2626",
    cursor: "pointer",
    ariaLabel: "Action failed, click to retry",
  },
  disabled: {
    label: "",
    backgroundColor: "#9ca3af",
    cursor: "not-allowed",
    ariaLabel: "Button disabled",
  },
};
