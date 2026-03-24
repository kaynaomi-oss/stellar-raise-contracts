import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FrontendHeaderResponsive } from './frontend_header_responsive';

describe('FrontendHeaderResponsive Config & Styling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the branding logo correctly', () => {
    render(<FrontendHeaderResponsive isWalletConnected={false} />);
    expect(screen.getByText('Stellar Raise')).toBeTruthy();
  });

  it('renders navigation links reliably (gas-efficient rendering)', () => {
    // Ensuring the memoized links mount as expected
    render(<FrontendHeaderResponsive isWalletConnected={false} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Invest')).toBeTruthy();
    expect(screen.getByText('Docs')).toBeTruthy();
  });

  it('displays the correct wallet status when disconnected', () => {
    render(<FrontendHeaderResponsive isWalletConnected={false} />);
    const statusText = screen.getByText('Disconnected');
    expect(statusText).toBeTruthy();
    
    // Testing visual styling applied via dynamic properties
    const container = statusText.closest('.wallet-status');
    expect(container).toHaveStyle({ border: '1px solid #FF3B30' });
  });

  it('displays the correct wallet status when connected', () => {
    render(<FrontendHeaderResponsive isWalletConnected={true} />);
    const statusText = screen.getByText('Connected');
    expect(statusText).toBeTruthy();
    
    // Testing visual styling applied via dynamic properties
    const container = statusText.closest('.wallet-status');
    expect(container).toHaveStyle({ border: '1px solid #00C853' });
  });

  it('toggles mobile menu and invokes the callback properly', () => {
    const handleToggle = jest.fn();
    render(
      <FrontendHeaderResponsive 
        isWalletConnected={true} 
        onToggleMenu={handleToggle} 
      />
    );

    // Get the mobile menu toggle button by its aria-label
    const toggleButton = screen.getByRole('button', { name: "Toggle Navigation Menu" });
    
    // Initial state check
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(toggleButton).toHaveTextContent('☰');

    // Click to open
    fireEvent.click(toggleButton);

    // Verify state changed and callback invoked with 'true'
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(toggleButton).toHaveTextContent('✖');
    expect(handleToggle).toHaveBeenCalledTimes(1);
    expect(handleToggle).toHaveBeenCalledWith(true);

    // Click to close
    fireEvent.click(toggleButton);

    // Verify state reverted and callback invoked with 'false'
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(toggleButton).toHaveTextContent('☰');
    expect(handleToggle).toHaveBeenCalledTimes(2);
    expect(handleToggle).toHaveBeenCalledWith(false);
  });

  it('toggles mobile menu internally without a provided callback', () => {
    // Render without onToggleMenu to hit the branch missing the callback
    render(<FrontendHeaderResponsive isWalletConnected={false} />);
    
    const toggleButton = screen.getByRole('button', { name: "Toggle Navigation Menu" });
    
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    
    // We should be able to click it and just change internal state without throwing
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });
});
