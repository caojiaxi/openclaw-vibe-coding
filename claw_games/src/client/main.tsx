import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components';
import { LeaderboardPage, MatchHistoryPage, MatchDetailPage } from './pages';
import './index.css';

function App(): React.JSX.Element {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
