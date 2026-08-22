import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, useNavigate, Navigate } from 'react-router-dom';
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
import { BanksPage } from './pages/BanksPage';
import { RetainersPage } from './pages/RetainersPage';
import { DocumentEditorPage } from './pages/DocumentEditorPage';
import { getUserPermission } from './utils/rbac';
import { fetchMeApi } from './api/client';
import { PROJECTS } from './store/mockData';
import './styles/tokens.css';

function ProtectedModule({ user, moduleKey, element }: { user: any; moduleKey: string; element: React.ReactElement }) {
  const perm = getUserPermission(user, moduleKey);
  if (perm === 'denied') {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, margin: 24 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
        <h2 style={{ color: '#f87171', margin: '0 0 10px 0', fontSize: 20 }}>Modulo Bloccato per questo Utente</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 520, margin: '0 auto 24px auto', lineHeight: 1.6 }}>
          Il tuo profilo (<strong>{user?.nome || user?.email}</strong>) non dispone dei permessi di accesso per visualizzare la sezione <code>{moduleKey}</code> (impostata su <span style={{ color: '#ef4444', fontWeight: 700 }}>BLOCCATO</span> nella Matrice Permessi RBAC dello studio).
        </p>
        <button
          onClick={() => window.history.back()}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Torna alla Sezione Precedente
        </button>
      </div>
    );
  }
  return element;
}

function MainLayoutWrapper({ user, onLogout }: { user: any; onLogout: () => void }) {
  const alertCount = PROJECTS.filter(p => p.delay).length;
  return (
    <AppLayout alertCount={alertCount} user={user} onLogout={onLogout}>
      <Outlet />
    </AppLayout>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('bluman_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('bluman_jwt_token') || localStorage.getItem('bluman_token'));
  const [isLoggedOut, setIsLoggedOut] = useState(false);

  const handleLoginSuccess = (user: any, jwtToken: string) => {
    setCurrentUser(user);
    setToken(jwtToken);
    localStorage.setItem('bluman_jwt_token', jwtToken);
    localStorage.setItem('bluman_user', JSON.stringify(user));
    setIsLoggedOut(false);
    navigate('/', { replace: true });
  };

  const handleLogout = () => {
    localStorage.removeItem('bluman_jwt_token');
    localStorage.removeItem('bluman_token');
    localStorage.removeItem('bluman_user');
    setCurrentUser(null);
    setToken(null);
    setIsLoggedOut(true);
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    const onUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener('bluman_unauthorized', onUnauthorized);
    return () => window.removeEventListener('bluman_unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (token) {
      fetchMeApi()
        .then((res) => {
          if (res && res.user) {
            const isMust = Boolean(res.user.mustChangePassword ?? (res.user.stato === 'invitato'));
            setCurrentUser((prev: any) => ({
              ...(prev || {}),
              ...res.user,
              mustChangePassword: isMust,
            }));
            const userRaw = localStorage.getItem('bluman_user');
            if (userRaw) {
              try {
                const u = JSON.parse(userRaw);
                u.mustChangePassword = isMust;
                u.stato = res.user.stato;
                localStorage.setItem('bluman_user', JSON.stringify(u));
              } catch {}
            }
          }
        })
        .catch(() => {});
    }
  }, [token]);

  const isAuthenticated = !isLoggedOut && Boolean(currentUser && token);

  return (
    <Routes>
      {/* Client Portal Standalone */}
      <Route path="/portal" element={<ClientPortal />} />

      {/* Login Route */}
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage onLoginSuccess={handleLoginSuccess} />
          )
        }
      />

      {/* Authenticated routes or fallback to login */}
      {isAuthenticated ? (
        <Route element={<MainLayoutWrapper user={currentUser} onLogout={handleLogout} />}>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/projects"      element={<ProtectedModule user={currentUser} moduleKey="projects" element={<Projects />} />} />
          <Route path="/projects/:id"  element={<ProtectedModule user={currentUser} moduleKey="projects" element={<ProjectDetail />} />} />
          <Route path="/clients"       element={<ProtectedModule user={currentUser} moduleKey="clients" element={<ClientsPage />} />} />
          <Route path="/calendar"      element={<ProtectedModule user={currentUser} moduleKey="calendar" element={<CalendarPage />} />} />
          <Route path="/invoices"      element={<ProtectedModule user={currentUser} moduleKey="invoices" element={<InvoicesPage />} />} />
          <Route path="/scadenzario"   element={<ProtectedModule user={currentUser} moduleKey="scadenzario" element={<ScadenzarioPage />} />} />
          <Route path="/primanota"     element={<ProtectedModule user={currentUser} moduleKey="primanota" element={<PrimaNotaPage />} />} />
          <Route path="/banks"         element={<ProtectedModule user={currentUser} moduleKey="banks" element={<BanksPage />} />} />
          <Route path="/payments"      element={<ProtectedModule user={currentUser} moduleKey="banks" element={<PaymentsPage />} />} />
          <Route path="/retainers"     element={<ProtectedModule user={currentUser} moduleKey="retainers" element={<RetainersPage />} />} />
          <Route path="/documents"     element={<ProtectedModule user={currentUser} moduleKey="documents" element={<DocumentEditorPage />} />} />
          <Route path="/audit"         element={<ProtectedModule user={currentUser} moduleKey="audit" element={<AuditLogPage />} />} />
          <Route path="/admin/tenants" element={<SuperAdminPage />} />
          <Route path="/library"       element={<ProtectedModule user={currentUser} moduleKey="library" element={<Library />} />} />
          <Route path="/settings"      element={<ProtectedModule user={currentUser} moduleKey="settings" element={<SettingsPage />} />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
