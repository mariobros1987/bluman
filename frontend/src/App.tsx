import React from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard }    from './pages/Dashboard';
import { Projects }     from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Library }      from './pages/Library';
import { ClientsPage }  from './pages/ClientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ClientPortal } from './pages/ClientPortal';
import { Calendar }     from './pages/Placeholders';
import { PROJECTS } from './store/mockData';
import './styles/tokens.css';

function MainLayoutWrapper() {
  const alertCount = PROJECTS.filter(p => p.delay).length;
  return (
    <AppLayout alertCount={alertCount}>
      <Outlet />
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Client Portal Standalone */}
        <Route path="/portal" element={<ClientPortal />} />

        {/* Advisor Platform Layout con Outlet */}
        <Route element={<MainLayoutWrapper />}>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/projects"      element={<Projects />} />
          <Route path="/projects/:id"  element={<ProjectDetail />} />
          <Route path="/clients"       element={<ClientsPage />} />
          <Route path="/calendar"      element={<Calendar />} />
          <Route path="/library"       element={<Library />} />
          <Route path="/settings"      element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
