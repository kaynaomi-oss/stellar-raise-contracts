import React, { useState, useCallback, useMemo } from 'react';

/**
 * @title Responsive Frontend Header
 * @dev NatSpec: This React functional component provides a responsive header
 * navigation bar. It includes a mobile hamburger menu, desktop navigation links,
 * and a wallet connection status indicator.
 *
 * @custom:efficiency This component incorporates `useCallback` and `useMemo` hooks
 * to minimize unnecessary re-renders. By memoizing the toggle handler and the
 * navigation links array, we ensure that React's reconciliation process (the "gas" of the UI layer)
 * is as efficient as possible.
 *
 * @custom:security The rendered links and wallet status rely strictly on props or safe,
 * hardcoded state, mitigating XSS risks.
 */

// Define the shape of the component's props for clear type checking
export interface FrontendHeaderResponsiveProps {
  /**
   * @dev Boolean flag indicating if the user's wallet is currently connected.
   */
  isWalletConnected: boolean;
  /**
   * @dev Optional callback fired whenever the mobile menu is toggled.
   * Useful for parent components that need to respond to the menu state.
   */
  onToggleMenu?: (isOpen: boolean) => void;
}

export const FrontendHeaderResponsive: React.FC<FrontendHeaderResponsiveProps> = ({
  isWalletConnected,
  onToggleMenu
}) => {
  // Setup local state for handling the mobile menu expansion
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  /**
   * @dev Memoize the toggle handler to prevent the function from being recreated
   * on every render, enhancing React rendering efficiency.
   */
  const handleToggleMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => {
      const newState = !prev;
      // If a parent provided a callback, notify it of the new state
      if (onToggleMenu) {
        onToggleMenu(newState);
      }
      return newState;
    });
  }, [onToggleMenu]);

  /**
   * @dev Memoize the navigation links. Static arrays defined inside components
   * normally get recreated every render. Using `useMemo` prevents this.
   */
  const navLinks = useMemo(() => [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Invest', href: '/invest' },
    { label: 'Docs', href: '/docs' }
  ], []);

  /**
   * @dev Component rendering utilizing inline CSS-in-JS style objects.
   * These styles adapt to responsive breakpoints through standard CSS (e.g., in responsive.css)
   * where `md:hidden`, `md:flex`, etc., are defined.
   */
  return (
    <header 
      className="frontend-header"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 2rem',
        backgroundColor: '#0A1929', // Deep navy from brand colors
        color: '#FFFFFF',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
      }}
    >
      {/* Brand Logo Section */}
      <div className="header-logo" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
        Stellar Raise
      </div>

      {/* Mobile Menu Toggle Button (Visible only on small screens) */}
      <button
        className="mobile-menu-toggle md:hidden"
        onClick={handleToggleMenu}
        aria-label="Toggle Navigation Menu"
        aria-expanded={isMobileMenuOpen}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: '0.5rem',
          display: 'block' // Normally hidden by external css on larger screens
        }}
      >
        {isMobileMenuOpen ? '✖' : '☰'}
      </button>

      {/* Navigation Links Area (Desktop view, or shown conditionally on mobile) */}
      <nav
        className={`nav-links ${isMobileMenuOpen ? 'block' : 'hidden'} md:flex`}
        style={{
          display: 'flex',
          gap: '1.5rem',
          alignItems: 'center'
        }}
      >
        {navLinks.map(link => (
          <a
            key={link.label}
            href={link.href}
            style={{
              color: 'inherit',
              textDecoration: 'none',
              fontWeight: 500,
              padding: '0.5rem'
            }}
          >
            {link.label}
          </a>
        ))}

        {/* Wallet Status Indicator */}
        <div 
          className="wallet-status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '9999px',
            backgroundColor: isWalletConnected ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255, 59, 48, 0.1)',
            border: `1px solid ${isWalletConnected ? '#00C853' : '#FF3B30'}`,
            marginLeft: '1rem'
          }}
        >
          {/* Status dot */}
          <span 
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isWalletConnected ? '#00C853' : '#FF3B30'
            }}
          />
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {isWalletConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </nav>
    </header>
  );
};
