import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Home from '@/pages/Home';
import SportsIndex from '@/pages/SportsIndex';
import SportPage from '@/pages/SportPage';
import Competitions from '@/pages/Competitions';
import Casino from '@/pages/Casino';
import EventDetail from '@/pages/EventDetail';
import SearchPage from '@/pages/SearchPage';
import MySimulations from '@/pages/MySimulations';
import Affiliate from '@/pages/Affiliate';
import Profile from '@/pages/Profile';
import SettingsPage from '@/pages/SettingsPage';
import WalletPage from '@/pages/Wallet';
import DepositPage from '@/pages/DepositPage';
import WithdrawPage from '@/pages/WithdrawPage';
import Admin from '@/pages/Admin';
import { Terms, Privacy } from '@/pages/Legal';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/esportes" element={<SportsIndex />} />
        <Route path="/esporte/:slug" element={<SportPage />} />
        <Route path="/competicoes" element={<Competitions />} />
        <Route path="/cassino" element={<Casino />} />
        <Route path="/partida/:id" element={<EventDetail />} />
        <Route path="/busca" element={<SearchPage />} />
        <Route path="/termos" element={<Terms />} />
        <Route path="/privacidade" element={<Privacy />} />

        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
          <Route path="/minhas-simulacoes" element={<MySimulations />} />
          <Route path="/carteira" element={<WalletPage />} />
          <Route path="/deposito" element={<DepositPage />} />
          <Route path="/saque" element={<WithdrawPage />} />
          <Route path="/indique-e-ganhe" element={<Affiliate />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Painel administrativo em tela cheia, fora do layout da plataforma. */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App