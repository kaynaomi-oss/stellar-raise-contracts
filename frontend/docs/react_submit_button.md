# React Submit Button Component States

## Purpose

`react_submit_button.tsx` centralizes submit-button state behavior to improve security and reliability in form workflows.

Goals:

- prevent accidental duplicate submissions
- enforce deterministic state transitions
- normalize and bound labels from possibly untrusted sources
- keep behavior accessible and easy to audit

## File Locations

- Component contract and implementation: `frontend/components/react_submit_button.tsx`
- Comprehensive tests: `frontend/components/react_submit_button.test.tsx`

## State Model

Supported states are strictly typed:
`react_submit_button.tsx` provides a scalable submit-button state model that standardizes behavior across forms and workflows.

It focuses on:

- predictable state mapping
- accessibility defaults
- safer label handling
- easy extensibility for future states

## File locations

- Component: `frontend/components/react_submit_button.tsx`
- Tests: `frontend/components/react_submit_button.test.tsx`

## State model

The component supports a strict state union:

- `idle`
- `submitting`
- `success`
- `error`
- `disabled`

A transition map enforces allowed movement between states when `strictTransitions` is enabled.

## Security Assumptions

1. Label overrides may originate from untrusted input (CMS, API payloads, operator configuration).
2. React string rendering is used and no `dangerouslySetInnerHTML` path is exposed.
3. Consumers may attempt invalid state jumps under race conditions.

## Security and Reliability Safeguards

1. Label normalization rejects non-string values and empty strings.
2. Control characters are removed and whitespace is normalized.
3. Labels are truncated to 80 characters to reduce layout abuse.
4. Invalid state transitions are rejected in strict mode by falling back to the previous valid state.
5. Interaction is blocked while submitting or locally in-flight to reduce double-submit risk.
6. `aria-busy` and `aria-live` semantics are set for assistive technology reliability.

## Usage Example
This ensures only approved states are used in consuming code and avoids ad-hoc string behavior.

## Security assumptions and safeguards

### Assumptions

- Labels may originate from untrusted sources (for example, API-driven copy or admin configuration).
- Consumers should not pass raw HTML into UI APIs.

### Safeguards implemented

1. **Text-only rendering path**  
   Labels are rendered as normal React string children. React escapes these values by default, reducing XSS risk when strings include markup-like text.

2. **Label normalization and fallback**  
   Empty or whitespace-only labels are rejected and replaced with known defaults, preventing blank CTA states.

3. **Label length bounding**  
   Labels are capped to 80 characters to prevent visual abuse and accidental layout breaks.

4. **State-based disable guard**  
   Click handling is removed when state is `submitting` or `disabled`, reducing duplicate submissions.

5. **Accessibility signaling**  
   `aria-busy` is enabled only while submitting; `aria-live="polite"` allows assistive technologies to announce state text changes.

## Usage example

```tsx
import ReactSubmitButton from "../components/react_submit_button";

<ReactSubmitButton
  state="submitting"
  previousState="idle"
  strictTransitions
  type="submit"
  labels={{ idle: "Create Campaign", submitting: "Creating..." }}
  onClick={handleCreate}
/>;
```

## Test Coverage

`react_submit_button.test.tsx` verifies:

- default and custom label behavior
- non-string and whitespace label fallback handling
- control-character stripping and length truncation
- valid and invalid state transitions
- strict vs non-strict state resolution
- interaction blocking and busy-state guards
- hostile markup-like label handling assumptions

## Latest Test Output

Executed on March 24, 2026:

```text
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
Snapshots:   0 total
```

## Security Notes for Reviewers

- Hostile strings are intentionally preserved as plain text labels to rely on React escaping semantics.
- The component does not expose raw HTML rendering APIs.
- If future requirements need rich text labels, add explicit sanitization before rendering.
## Testing coverage

`react_submit_button.test.tsx` validates:

- default labels per state
- custom label overrides
- fallback behavior for invalid labels
- long-label truncation edge case
- hostile label string handling assumptions
- disabled-state logic
- busy-state logic

## Review notes

- The component exports pure helper functions (`resolveSubmitButtonLabel`, `isSubmitButtonDisabled`, `isSubmitButtonBusy`) to keep tests deterministic and lightweight.
- Styling is state-mapped via a single lookup table to make future variants easy to add and review.
