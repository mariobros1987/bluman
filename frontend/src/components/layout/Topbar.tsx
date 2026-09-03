import React from 'react';
import { useAuthStore } from '@/store/auth';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const profile = useAuthStore(state => state.profile);

  return (
    <header className="topbar">
      <div className="topbar-search">
        {/* Placeholder per eventuale ricerca globale */}
      </div>
      
      <div className="topbar-user">
        <div className="user-info">
          <span className="user-name">{profile?.nome || 'Utente'}</span>
          <span className="user-role text-muted text-xs">
            {profile?.ruolo === 'advisor' ? 'Advisor' : 'Cliente'}
          </span>
        </div>
        <div className="user-avatar" style={{ backgroundColor: profile?.colore || 'var(--primary)' }}>
          {profile?.avatar_ini || 'U'}
        </div>
      </div>
    </header>
  );
};
