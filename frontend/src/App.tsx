import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { Layout } from '@/components/layout/Layout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Login } from '@/views/Login';
import { Dashboard } from '@/views/Dashboard';
import { Progetti } from '@/views/Progetti';
import { ProgettoDetail } from '@/views/ProgettoDetail';
import { Clienti } from '@/views/Clienti';
import { Preventivi } from '@/views/Preventivi';
import { PreventivoWizard } from '@/views/PreventivoWizard';
import { Libreria } from '@/views/Libreria';
import { Team } from '@/views/Team';
import { Calendario } from '@/views/Calendario';
import { SuperAdmin } from '@/views/SuperAdmin';
import { PortaleDashboard } from '@/views/portale/PortaleDashboard';

export const App: React.FC = () => {
  const { initialize, loading } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (loading) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Avvio in corso...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        
        {/* Rotte Advisor — protette */}
        <Route path="/app" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="progetti" element={<Progetti />} />
          <Route path="progetti/:id" element={<ProgettoDetail />} />
          <Route path="clienti" element={<Clienti />} />
          <Route path="preventivi" element={<Preventivi />} />
          <Route path="preventivi/nuovo" element={<PreventivoWizard />} />
          <Route path="libreria" element={<Libreria />} />
          <Route path="team" element={<Team />} />
          <Route path="calendario" element={<Calendario />} />
        </Route>

        {/* Rotte Super Admin — protette */}
        <Route path="/admin" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<SuperAdmin />} />
        </Route>

        {/* Rotte Cliente */}
        <Route path="/portale">
          <Route path="dashboard" element={<PortaleDashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
