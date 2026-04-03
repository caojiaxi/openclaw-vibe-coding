import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const navLinks = [
  { to: '/', label: 'Leaderboard' },
  { to: '/matches', label: 'Match History' },
];

export function Navbar(): React.JSX.Element {
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-50 border-b border-claw-700 bg-claw-800/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <span className="text-2xl">&#128062;</span>
          <span className="bg-gradient-to-r from-claw-accent-light to-claw-gold bg-clip-text text-transparent">
            Claw Games
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive =
              link.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-claw-accent/20 text-claw-accent-light'
                    : 'text-gray-400 hover:bg-claw-700 hover:text-gray-200'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
