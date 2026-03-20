import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Instances } from './pages/Instances';
import { InstanceDetail } from './pages/InstanceDetail';
import { Alerts } from './pages/Alerts';
import { QueryExplorer } from './pages/QueryExplorer';
import { Login } from './pages/Login';
import { isAuthenticated } from './lib/auth';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/instances" element={<Instances />} />
          <Route path="/instances/:id" element={<InstanceDetail />} />
          <Route path="/instances/:id/queries" element={<QueryExplorer />} />
          <Route path="/alerts" element={<Alerts />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
