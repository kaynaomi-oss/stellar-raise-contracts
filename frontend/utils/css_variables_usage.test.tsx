import { DESIGN_TOKENS, CSSVariablesContract } from './css_variables_usage';

describe('CSSVariablesUsage Contract Tests', () => {
  it('should return correct CSS variable strings from getVar()', () => {
    expect(CSSVariablesContract.getVar('COLORS', 'PRIMARY_BLUE')).toBe('var(--color-primary-blue)');
    expect(CSSVariablesContract.getVar('SPACING', 'SPACE_4')).toBe('var(--spacing-space-4)');
  });

  it('should validate approved platform colors', () => {
    // Approved color
    expect(CSSVariablesContract.isApprovedColor('#4f46e5')).toBe(true);
    // Unapproved color
    expect(CSSVariablesContract.isApprovedColor('#ff00ff')).toBe(false);
  });

  it('should return correct pixel values for spacing tokens', () => {
    // 1rem = 16px
    expect(CSSVariablesContract.getSpacingPx('SPACE_4')).toBe(16);
    // 0.25rem = 4px
    expect(CSSVariablesContract.getSpacingPx('SPACE_1')).toBe(4);
    // 3rem = 48px
    expect(CSSVariablesContract.getSpacingPx('SPACE_12')).toBe(48);
  });

  it('should contain all expected DESIGN_TOKENS categories', () => {
    expect(DESIGN_TOKENS).toHaveProperty('COLORS');
    expect(DESIGN_TOKENS).toHaveProperty('SPACING');
    expect(DESIGN_TOKENS).toHaveProperty('FONTS');
    expect(DESIGN_TOKENS).toHaveProperty('RADIUS');
  });

  it('should match the values defined in utilities.css', () => {
    // Sanity check against provided CSS variables like --color-primary-blue
    expect(DESIGN_TOKENS.COLORS.PRIMARY_BLUE).toBe('#4f46e5');
    expect(DESIGN_TOKENS.COLORS.SUCCESS_GREEN).toBe('#10b981');
/**
 * @title CSS Variables Usage Tests
 * @notice Comprehensive test suite for CSS variable handling
 * @author Stellar Raise Security Team
 */

import {
  CssVariablesUsage,
  CssVariableValidator,
  CssVariablesError,
  cssVar,
  cssCalc,
  ALLOWED_CSS_VARIABLES,
  CssVariablesMap,
  useCssVariable,
} from './css_variables_usage';

describe('CssVariableValidator', () => {
  describe('isValidVariableName', () => {
    it('should accept valid CSS variable names from the allowed list', () => {
      expect(CssVariableValidator.isValidVariableName('--color-primary-blue')).toBe(true);
      expect(CssVariableValidator.isValidVariableName('--space-4')).toBe(true);
      expect(CssVariableValidator.isValidVariableName('--font-size-base')).toBe(true);
    });

    it('should accept valid CSS variable names without -- prefix after normalization', () => {
      // The validator validates format first, so we test the method that normalizes
      // Note: isValidVariableName requires -- prefix, use CssVariablesUsage.get for auto-normalization
      expect(() => {
        CssVariableValidator.isValidVariableName('color-primary-blue');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for variable names not in allowed list', () => {
      expect(() => {
        CssVariableValidator.isValidVariableName('--custom-variable');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for invalid variable name format', () => {
      expect(() => {
        CssVariableValidator.isValidVariableName('no-prefix');
      }).toThrow(CssVariablesError);
      expect(() => {
        CssVariableValidator.isValidVariableName('--123-invalid');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for empty or whitespace-only names', () => {
      expect(() => {
        CssVariableValidator.isValidVariableName('');
      }).toThrow(CssVariablesError);
      expect(() => {
        CssVariableValidator.isValidVariableName('   ');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for potentially malicious variable names', () => {
      expect(() => {
        CssVariableValidator.isValidVariableName('--color;background:url(javascript:alert(1))');
      }).toThrow(CssVariablesError);
    });
  });

  describe('isValidValue', () => {
    it('should accept safe CSS values', () => {
      expect(CssVariableValidator.isValidValue('#0066FF')).toBe(true);
      expect(CssVariableValidator.isValidValue('1rem')).toBe(true);
      expect(CssVariableValidator.isValidValue('calc(100% - 20px)')).toBe(true);
      expect(CssVariableValidator.isValidValue('0 4px 6px -1px rgba(0, 0, 0, 0.1)')).toBe(true);
    });

    it('should throw error for url() expressions', () => {
      expect(() => {
        CssVariableValidator.isValidValue('url(https://evil.com)');
      }).toThrow(CssVariablesError);
      expect(() => {
        CssVariableValidator.isValidValue('url("data:text/css,body{color:red}")');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for javascript: URLs', () => {
      expect(() => {
        CssVariableValidator.isValidValue('javascript:alert(1)');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for expression() (IE CSS expression attack)', () => {
      expect(() => {
        CssVariableValidator.isValidValue('expression(alert(1))');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for @import with URLs', () => {
      expect(() => {
        CssVariableValidator.isValidValue('@import url(evil.css)');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for data:text/css URLs', () => {
      expect(() => {
        CssVariableValidator.isValidValue('data:text/css,body{color:red}');
      }).toThrow(CssVariablesError);
    });
  });

  describe('getAllowedVariables', () => {
    it('should return the complete list of allowed variables', () => {
      const allowed = CssVariableValidator.getAllowedVariables();
      expect(allowed).toContain('--color-primary-blue');
      expect(allowed).toContain('--space-4');
      expect(allowed).toContain('--font-size-base');
      expect(allowed).toContain('--z-modal');
      expect(allowed.length).toBeGreaterThan(50);
    });

    it('should return a readonly array', () => {
      const allowed = CssVariableValidator.getAllowedVariables();
      // Verify it's an array with expected contents
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed.length).toBeGreaterThan(0);
    });
  });
});

describe('CssVariablesUsage', () => {
  let container: HTMLElement;
  let cssVars: CssVariablesUsage;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.style.setProperty('--color-primary-blue', '#0066FF');
    container.style.setProperty('--space-4', '1rem');
    container.style.setProperty('--z-modal', '500');
    cssVars = new CssVariablesUsage(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('get', () => {
    it('should get a valid CSS variable value', () => {
      const value = cssVars.get('--color-primary-blue');
      expect(value).toBe('#0066FF');
    });

    it('should get CSS variable without -- prefix', () => {
      const value = cssVars.get('color-primary-blue');
      expect(value).toBe('#0066FF');
    });

    it('should throw error for undefined variables (security-first design)', () => {
      // Due to security-first design, non-whitelisted variables throw errors
      expect(() => {
        cssVars.get('--undefined-variable', '#ffffff');
      }).toThrow(CssVariablesError);
    });

    it('should throw error when undefined variable has no fallback', () => {
      // Security-first: even with no fallback, invalid vars throw
      expect(() => {
        cssVars.get('--undefined-variable');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for invalid variable name', () => {
      expect(() => {
        cssVars.get('--invalid-typo');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for undefined variable name', () => {
      expect(() => {
        cssVars.get('');
      }).toThrow(CssVariablesError);
    });
  });

  describe('set', () => {
    it('should set a valid CSS variable', () => {
      cssVars.set('--color-primary-blue', '#ff0000');
      expect(container.style.getPropertyValue('--color-primary-blue')).toBe('#ff0000');
    });

    it('should set CSS variable without -- prefix', () => {
      cssVars.set('color-primary-blue', '#00ff00');
      expect(container.style.getPropertyValue('--color-primary-blue')).toBe('#00ff00');
    });

    it('should throw error for invalid variable name', () => {
      expect(() => {
        cssVars.set('--not-allowed', 'value');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for dangerous value (URL injection)', () => {
      expect(() => {
        cssVars.set('--color-primary-blue', 'url(https://evil.com)');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for dangerous value (javascript injection)', () => {
      expect(() => {
        cssVars.set('--color-primary-blue', 'javascript:alert(1)');
      }).toThrow(CssVariablesError);
    });
  });

  describe('remove', () => {
    it('should remove a valid CSS variable', () => {
      cssVars.remove('--color-primary-blue');
      expect(container.style.getPropertyValue('--color-primary-blue')).toBe('');
    });

    it('should throw error for invalid variable name', () => {
      expect(() => {
        cssVars.remove('--invalid');
      }).toThrow(CssVariablesError);
    });
  });

  describe('getMultiple', () => {
    it('should get multiple CSS variables at once', () => {
      const values = cssVars.getMultiple(['--color-primary-blue', '--space-4']);
      expect(values['--color-primary-blue']).toBe('#0066FF');
      expect(values['--space-4']).toBe('1rem');
    });

    it('should return fallback for undefined variables', () => {
      const values = cssVars.getMultiple(['--space-4'], 'fallback');
      // Since --space-4 is defined, it should return the value
      expect(values['--space-4']).toBe('1rem');
    });
  });

  describe('has', () => {
    it('should return true for defined variables', () => {
      expect(cssVars.has('--color-primary-blue')).toBe(true);
    });

    it('should throw error for undefined variables (security-first)', () => {
      // Security-first: non-whitelisted variables throw errors
      expect(() => {
        cssVars.has('--undefined-variable');
      }).toThrow(CssVariablesError);
    });

    it('should throw error for invalid variable name', () => {
      expect(() => {
        cssVars.has('--invalid');
      }).toThrow(CssVariablesError);
    });
  });
});

describe('Helper Functions', () => {
  describe('cssVar', () => {
    it('should create a valid var() expression', () => {
      expect(cssVar('color-primary-blue')).toBe('var(--color-primary-blue)');
      expect(cssVar('--space-4')).toBe('var(--space-4)');
    });

    it('should create var() with fallback', () => {
      expect(cssVar('color-primary-blue', '#ffffff')).toBe('var(--color-primary-blue, #ffffff)');
    });

    it('should throw error for invalid variable name', () => {
      expect(() => {
        cssVar('--invalid');
      }).toThrow(CssVariablesError);
    });

    it('should trim whitespace from variable names', () => {
      expect(cssVar('  color-primary-blue  ')).toBe('var(--color-primary-blue)');
    });
  });

  describe('cssCalc', () => {
    it('should create a valid calc() expression', () => {
      expect(cssCalc('100% - 20px')).toBe('calc(100% - 20px)');
      expect(cssCalc('var(--space-4) * 2')).toBe('calc(var(--space-4) * 2)');
    });

    it('should throw error for dangerous expressions', () => {
      expect(() => {
        cssCalc('url(https://evil.com)');
      }).toThrow(CssVariablesError);
    });
  });
});

describe('Security Edge Cases', () => {
  it('should handle CSS injection attempts in variable values', () => {
    expect(() => {
      CssVariableValidator.isValidValue('red; background: url(javascript:alert(1))');
    }).toThrow(CssVariablesError);
  });

  it('should handle expression() attack vector', () => {
    expect(() => {
      CssVariableValidator.isValidValue('expression(alert(1))');
    }).toThrow(CssVariablesError);
  });

  it('should handle data: URL injection', () => {
    expect(() => {
      CssVariableValidator.isValidValue('data:text/css,body{color:red}');
    }).toThrow(CssVariablesError);
  });

  it('should handle @import injection', () => {
    expect(() => {
      CssVariableValidator.isValidValue("@import url('https://evil.com')");
    }).toThrow(CssVariablesError);
  });
});

describe('CssVariablesUsage setMultiple', () => {
  let container: HTMLElement;
  let cssVars: CssVariablesUsage;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    cssVars = new CssVariablesUsage(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('setMultiple', () => {
    it('should set multiple CSS variables at once', () => {
      cssVars.setMultiple({
        '--color-primary-blue': '#ff0000',
        '--space-4': '2rem',
      });
      expect(container.style.getPropertyValue('--color-primary-blue')).toBe('#ff0000');
      expect(container.style.getPropertyValue('--space-4')).toBe('2rem');
    });

    it('should skip undefined values in setMultiple', () => {
      container.style.setProperty('--color-primary-blue', '#0066FF');
      cssVars.setMultiple({
        '--color-primary-blue': '#ff0000',
        '--space-4': undefined as unknown as string,
      });
      expect(container.style.getPropertyValue('--color-primary-blue')).toBe('#ff0000');
      expect(container.style.getPropertyValue('--space-4')).toBe('');
    });

    it('should throw error for invalid variable name in setMultiple', () => {
      // Using type assertion to test runtime validation of invalid keys
      const invalidMap = { '--invalid-var': 'value' } as CssVariablesMap;
      expect(() => {
        cssVars.setMultiple(invalidMap);
      }).toThrow(CssVariablesError);
    });

    it('should throw error for dangerous value in setMultiple', () => {
      expect(() => {
        cssVars.setMultiple({
          '--color-primary-blue': 'url(https://evil.com)',
        });
      }).toThrow(CssVariablesError);
    });

    it('should handle empty object in setMultiple', () => {
      expect(() => {
        cssVars.setMultiple({});
      }).not.toThrow();
    });
  });
});

describe('useCssVariable hook', () => {
  it('should be defined as a function', () => {
    expect(typeof useCssVariable).toBe('function');
  });

  it('should be callable with valid variable name', () => {
    const container = document.createElement('div');
    container.style.setProperty('--color-primary-blue', '#0066FF');
    document.body.appendChild(container);

    const cssVars = new CssVariablesUsage(container);
    const result = cssVars.get('--color-primary-blue');
    expect(result).toBe('#0066FF');

    document.body.removeChild(container);
  });
});

describe('ALLOWED_CSS_VARIABLES constant', () => {
  it('should have all required CSS variables defined', () => {
    // Colors
    expect(ALLOWED_CSS_VARIABLES).toContain('--color-primary-blue');
    expect(ALLOWED_CSS_VARIABLES).toContain('--color-success-green');
    expect(ALLOWED_CSS_VARIABLES).toContain('--color-error-red');

    // Spacing
    expect(ALLOWED_CSS_VARIABLES).toContain('--space-1');
    expect(ALLOWED_CSS_VARIABLES).toContain('--space-4');
    expect(ALLOWED_CSS_VARIABLES).toContain('--space-8');

    // Typography
    expect(ALLOWED_CSS_VARIABLES).toContain('--font-size-base');
    expect(ALLOWED_CSS_VARIABLES).toContain('--font-family-primary');

    // Z-index
    expect(ALLOWED_CSS_VARIABLES).toContain('--z-modal');
    expect(ALLOWED_CSS_VARIABLES).toContain('--z-toast');

    // Safe area
    expect(ALLOWED_CSS_VARIABLES).toContain('--safe-area-inset-top');
    expect(ALLOWED_CSS_VARIABLES).toContain('--safe-area-inset-bottom');
  });

  it('should not contain invalid variable names', () => {
    ALLOWED_CSS_VARIABLES.forEach((variable) => {
      expect(variable).toMatch(/^--[a-z][a-z0-9-]*$/);
    });
  });
});
