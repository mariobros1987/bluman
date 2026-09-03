import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, Users, Library, LogOut, FileText, UserCog, CalendarDays, Shield } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  const signOut = useAuthStore(state => state.signOut);
  const user = useAuthStore(state => state.user);

  const links = [
    { to: '/app/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/app/progetti', icon: <FolderKanban size={20} />, label: 'Progetti' },
    { to: '/app/clienti', icon: <Users size={20} />, label: 'Clienti' },
    { to: '/app/preventivi', icon: <FileText size={20} />, label: 'Preventivi' },
    { to: '/app/libreria', icon: <Library size={20} />, label: 'Libreria' },
    { to: '/app/team', icon: <UserCog size={20} />, label: 'Team' },
    { to: '/app/calendario', icon: <CalendarDays size={20} />, label: 'Calendario' },
  ];

  const isSuperAdmin = user?.app_metadata?.is_super_admin === true || user?.app_metadata?.ruolo === 'super_admin';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h2>BluMan<span>.</span></h2>
      </div>
      
      <nav className="sidebar-nav">
        {links.map(link => (
          <NavLink 
            key={link.to} 
            to={link.to}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            {link.icon}
            <span>{link.label}</span>
          </NavLink>
        ))}

        {isSuperAdmin && (
          <>
            <div className="sidebar-separator" />
            <NavLink
              to="/admin"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <Shield size={20} />
              <span>Super Admin</span>
            </NavLink>
          </>
        )}
      </nav>
      
      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={signOut}>
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
};

