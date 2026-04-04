/**
 * CSS Variables Usage — single source of truth for design tokens.
 */

export const DESIGN_TOKENS = {
  COLORS: {
    PRIMARY_BLUE: '#4f46e5',
    DEEP_NAVY: '#1e293b',
    SUCCESS_GREEN: '#10b981',
    ERROR_RED: '#ef4444',
    WARNING_ORANGE: '#f59e0b',
    NEUTRAL_100: '#f9fafb',
    NEUTRAL_200: '#f3f4f6',
    NEUTRAL_300: '#e5e7eb',
    NEUTRAL_700: '#374151',
  },
  SPACING: {
    SPACE_1: '0.25rem',
    SPACE_2: '0.5rem',
    SPACE_3: '0.75rem',
    SPACE_4: '1rem',
    SPACE_5: '1.25rem',
    SPACE_6: '1.5rem',
    SPACE_8: '2rem',
    SPACE_10: '2.5rem',
    SPACE_12: '3rem',
  },
  FONTS: {
    XS: '0.75rem',
    SM: '0.875rem',
    BASE: '1rem',
    LG: '1.125rem',
    XL: '1.25rem',
    '2XL': '1.5rem',
    '3XL': '1.875rem',
  },
  RADIUS: {
    SM: '0.125rem',
    MD: '0.375rem',
    LG: '0.5rem',
    XL: '0.75rem',
    FULL: '9999px',
  },
} as const;

export class CSSVariablesContract {
  static getVar(category: keyof typeof DESIGN_TOKENS, key: string): string {
    const formattedKey = key.toLowerCase().replace(/_/g, '-');
    return `var(--${category.toLowerCase().slice(0, -1)}-${formattedKey})`;
  }

  static isApprovedColor(hex: string): boolean {
    return Object.values(DESIGN_TOKENS.COLORS).includes(hex.toLowerCase() as never);
  }

  static getSpacingPx(key: keyof typeof DESIGN_TOKENS.SPACING): number {
    const remStr = DESIGN_TOKENS.SPACING[key];
    return parseFloat(remStr) * 16;
  }
}

/** @title CssVariableValidator — validates CSS variable names and values. */
export class CssVariableValidator {
  static isValidVariableName(variableName: string): boolean {
    return variableName.startsWith('--') && variableName.length > 2;
  }

  static isValidValue(value: string): boolean {
    const DANGEROUS = /url\s*\(|expression\s*\(|@import/i;
    return !DANGEROUS.test(value);
  }
}

/** @notice Gets a CSS variable value with SSR guard. */
export function useCssVariable(variableName: string, fallback?: string): string {
  if (typeof window === 'undefined') {
    return fallback ?? '';
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return value || fallback || '';
}

/** @notice Alias for documentation components. */
export function useDocsCssVariable(variableName: string, fallback?: string): string {
  return useCssVariable(variableName, fallback);
}

export default CSSVariablesContract;
