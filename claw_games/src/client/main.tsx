import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Navbar } from './components';
import { LeaderboardPage, MatchHistoryPage, MatchDetailPage, SpectatorPage, ReplayPage } from './pages';
import './index.css';

/** Full-screen routes hide the navbar and footer */
const FULLSCREEN_SUFFIXES = ['/spectate', '/replay'];

function App(): React.JSX.Element {
  const { pathname } = useLocation();
  const isFullscreen = FULLSCREEN_SUFFIXES.some(s => pathname.endsWith(s));

  if (isFullscreen) {
    return (
      <Routes>
        <Route path="/matches/:matchId/spectate" element={<SpectatorPage />} />
        <Route path="/matches/:matchId/replay" element={<ReplayPage />} />
      </Routes>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/matches" element={<MatchHistoryPage />} />
          <Route path="/matches/:matchId" element={<MatchDetailPage />} />
        </Routes>
      </main>
      <footer className="border-t border-claw-700 py-6 text-center text-xs text-gray-600">
        Claw Games &mdash; Competitive AI Gaming Platform
      </footer>
    </div>
  );
}

function Root(): React.JSX.Element {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
