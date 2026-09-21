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
import { FornitoriPage } from './pages/FornitoriPage';
import { LiquidazioneIvaPage } from './pages/LiquidazioneIvaPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ScadenzarioPage } from './pages/ScadenzarioPage';
import { PrimaNotaPage } from './pages/PrimaNotaPage';
import { BanksPage } from './pages/BanksPage';
import { RetainersPage } from './pages/RetainersPage';
import { DocumentEditorPage } from './pages/DocumentEditorPage';
import { ArchivioDocumentiPage } from './pages/ArchivioDocumentiPage';
import { CartellaModelliPage } from './pages/CartellaModelliPage';
import { ReportsPage } from './pages/ReportsPage';
import { TimesheetPage } from './pages/TimesheetPage';
import { getUserPermission } from './utils/rbac';
import { fetchMeApi } from './api/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/ToastProvider';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import './styles/tokens.css';
import { watchSystemTheme } from './utils/theme';
import { invalidateCache } from './api/cache';

function ProtectedModule({ user, moduleKey, element }: { user: any; moduleKey: string; element: React.ReactElement }) {
  const perm = getUserPermission(user, moduleKey);
  if (perm === 'denied') {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, margin: 24 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
        <h2 style={{ color: 'var(--red)', margin: '0 0 10px 0', fontSize: 20 }}>Modulo Bloccato per questo Utente</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 520, margin: '0 auto 24px auto', lineHeight: 1.6 }}>
          Il tuo profilo (<strong>{user?.nome || user?.email}</strong>) non dispone dei permessi di accesso per visualizzare la sezione <code>{moduleKey}</code> (impostata su <span style={{ color: 'var(--red)', fontWeight: 700 }}>BLOCCATO</span> nella Matrice Permessi RBAC dello studio).
        </p>
        <button
          onClick={() => window.history.back()}
          style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Torna alla Sezione Precedente
        </button>
      </div>
    );
  }
  return element;
}

function MainLayoutWrapper({ user, onLogout }: { user: any; onLogout: () => void }) {
  // Prima arrivava dallo store mock PROJECTS (ora rimosso): il conteggio degli avvisi
  // partirà dalle scadenze reali quando la campanella sarà collegata al database.
  const alertCount = 0;
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
    // Il tenant attivo va rimosso: altrimenti un super_admin che si riautentica riprende il
    // tenant precedente. E la cache in-memory va svuotata subito, non solo sul 401 automatico:
    // senza reload, l'utente successivo (stesso tenant) vedrebbe per ~30s liste e notifiche in
    // cache del precedente. invalidateCache() diretto (non l'evento bluman_unauthorized, che
    // richiamerebbe questo stesso handleLogout via listener → loop).
    localStorage.removeItem('bluman_tenant_id');
    invalidateCache();
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
        .catch((err) => {
          if (err instanceof Error && (err.message.includes('401') || err.message.includes('Non autenticato'))) {
            handleLogout();
          }
        });
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
          <Route path="/fornitori"     element={<ProtectedModule user={currentUser} moduleKey="invoices" element={<FornitoriPage />} />} />
          <Route path="/liquidazione-iva" element={<ProtectedModule user={currentUser} moduleKey="invoices" element={<LiquidazioneIvaPage />} />} />
          <Route path="/scadenzario"   element={<ProtectedModule user={currentUser} moduleKey="scadenzario" element={<ScadenzarioPage />} />} />
          <Route path="/primanota"     element={<ProtectedModule user={currentUser} moduleKey="primanota" element={<PrimaNotaPage />} />} />
          <Route path="/banks"         element={<ProtectedModule user={currentUser} moduleKey="banks" element={<BanksPage />} />} />
          <Route path="/payments"      element={<ProtectedModule user={currentUser} moduleKey="banks" element={<PaymentsPage />} />} />
          <Route path="/retainers"     element={<ProtectedModule user={currentUser} moduleKey="retainers" element={<RetainersPage />} />} />
          <Route path="/documents"     element={<ProtectedModule user={currentUser} moduleKey="documents" element={<DocumentEditorPage />} />} />
          <Route path="/editor"        element={<ProtectedModule user={currentUser} moduleKey="documents" element={<DocumentEditorPage />} />} />
          {/* §37 — l'archivio riusa la chiave RBAC `documents`: è la stessa materia, e una
              chiave nuova sarebbe bloccata per chiunque abbia già una matrice salvata. */}
          <Route path="/archivio"      element={<ProtectedModule user={currentUser} moduleKey="documents" element={<ArchivioDocumentiPage />} />} />
          {/* §41 — la cartella dei modelli dello studio: stessa materia di Document Studio, quindi
              stessa chiave RBAC `documents`. È da qui che Document Studio pesca i modelli. */}
          <Route path="/modelli"       element={<ProtectedModule user={currentUser} moduleKey="documents" element={<CartellaModelliPage />} />} />
          <Route path="/audit"         element={<ProtectedModule user={currentUser} moduleKey="audit" element={<AuditLogPage />} />} />
          <Route path="/reports"       element={<ProtectedModule user={currentUser} moduleKey="reports" element={<ReportsPage />} />} />
          <Route path="/timesheet"     element={<ProtectedModule user={currentUser} moduleKey="timesheet" element={<TimesheetPage />} />} />
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
  useEffect(() => watchSystemTheme(), []);
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
