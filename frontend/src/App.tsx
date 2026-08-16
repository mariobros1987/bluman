import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard }    from './pages/Dashboard';
import { Projects }     from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Library }      from './pages/Library';
import { ClientsPage }  from './pages/ClientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ClientPortal } from './pages/ClientPortal';
import { LoginPage }    from './pages/LoginPage';
import { CalendarPage } from './pages/CalendarPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ScadenzarioPage } from './pages/ScadenzarioPage';
import { PrimaNotaPage } from './pages/PrimaNotaPage';
import { RetainersPage } from './pages/RetainersPage';
import { PROJECTS } from './store/mockData';
import './styles/tokens.css';

function MainLayoutWrapper({ user, onLogout }: { user: any; onLogout: () => void }) {
  const alertCount = PROJECTS.filter(p => p.delay).length;
  return (
    <AppLayout alertCount={alertCount} user={user} onLogout={onLogout}>
      <Outlet />
    </AppLayout>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('bluman_user');
    return saved ? JSON.parse(saved) : { id: 'usr-01', nome: 'Joe Disabato', email: 'joe@bluecode.advisory', ruolo: 'advisor' };
  });

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('bluman_token'));
  const [isLoggedOut, setIsLoggedOut] = useState(false);

  const handleLoginSuccess = (user: any, jwtToken: string) => {
    setCurrentUser(user);
    setToken(jwtToken);
    setIsLoggedOut(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('bluman_token');
    localStorage.removeItem('bluman_user');
    setCurrentUser(null);
    setToken(null);
    setIsLoggedOut(true);
  };

  return (
    <BrowserRouter>
      {isLoggedOut || !currentUser ? (
        <Routes>
          <Route path="/portal" element={<ClientPortal />} />
          <Route path="*" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
        </Routes>
      ) : (
        <Routes>
          {/* Client Portal Standalone */}
          <Route path="/portal" element={<ClientPortal />} />

          {/* Advisor Platform Layout */}
          <Route element={<MainLayoutWrapper user={currentUser} onLogout={handleLogout} />}>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/projects"      element={<Projects />} />
            <Route path="/projects/:id"  element={<ProjectDetail />} />
            <Route path="/clients"       element={<ClientsPage />} />
            <Route path="/calendar"      element={<CalendarPage />} />
            <Route path="/invoices"      element={<InvoicesPage />} />
            <Route path="/scadenzario"   element={<ScadenzarioPage />} />
            <Route path="/primanota"     element={<PrimaNotaPage />} />
            <Route path="/payments"      element={<PaymentsPage />} />
            <Route path="/retainers"     element={<RetainersPage />} />
            <Route path="/audit"         element={<AuditLogPage />} />
            <Route path="/admin/tenants" element={<SuperAdminPage />} />
            <Route path="/library"       element={<Library />} />
            <Route path="/settings"      element={<SettingsPage />} />
          </Route>
        </Routes>
      )}
    </BrowserRouter>
  );
}
