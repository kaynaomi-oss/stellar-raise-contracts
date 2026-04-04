import React, { useState, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrontendHeaderResponsiveProps {
  /** Reflects whether the user's Stellar wallet is currently connected. */
  isWalletConnected: boolean;
  /** Optional callback fired whenever the mobile menu is opened or closed. */
  onToggleMenu?: (isOpen: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FrontendHeaderResponsive: React.FC<FrontendHeaderResponsiveProps> = ({
  isWalletConnected,
  onToggleMenu,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleToggleMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => {
      const newState = !prev;
      if (onToggleMenu) {
        onToggleMenu(newState);
      }
      return newState;
    });
  }, [onToggleMenu]);

  const navLinks = useMemo(() => [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Invest',    href: '/invest'    },
    { label: 'Docs',      href: '/docs'      },
  ], []);

  return (
    <header
      className="frontend-header"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 2rem',
        backgroundColor: '#0A1929',
        color: '#FFFFFF',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Brand Logo */}
      <div className="header-logo" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
        Stellar Raise
      </div>

      {/* Mobile Menu Toggle */}
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
          display: 'block',
        }}
      >
        {isMobileMenuOpen ? '✖' : '☰'}
      </button>

      {/* Navigation Links */}
      <nav
        className={`nav-links ${isMobileMenuOpen ? 'block' : 'hidden'} md:flex`}
        style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}
      >
        {navLinks.map(link => (
          <a
            key={link.label}
            href={link.href}
            style={{ color: 'inherit', textDecoration: 'none', fontWeight: 500, padding: '0.5rem' }}
          >
            {link.label}
          </a>
        ))}

        {/* Wallet Status Badge */}
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
            marginLeft: '1rem',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isWalletConnected ? '#00C853' : '#FF3B30',
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

export default FrontendHeaderResponsive;
