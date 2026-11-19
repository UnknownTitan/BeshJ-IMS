import { ConfigProvider, Result, Spin } from 'antd';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AppLayout from './layout/AppLayout';
import { MENU } from './layout/menu';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import SuppliersPage from './pages/SuppliersPage';
import CustomersPage from './pages/CustomersPage';
import PurchaseOrdersPage from './pages/purchasing/PurchaseOrdersPage';
import ReceivingPage from './pages/purchasing/ReceivingPage';
import OrdersPage from './pages/sales/OrdersPage';
import InvoicesPage from './pages/sales/InvoicesPage';
import InvoicePrint from './pages/sales/InvoicePrint';
import BreakagesPage from './pages/operations/BreakagesPage';
import EmptiesPage from './pages/operations/EmptiesPage';
import VansPage from './pages/operations/VansPage';
import StocktakePage from './pages/operations/StocktakePage';
import ReportsPage from './pages/ReportsPage';
import { AuditLogPage, ComingSoon, UsersPage } from './pages/AdminPages';

// Screens that exist so far. Everything else in MENU shows a "coming in Phase N" page.
const PAGES: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/products': <ProductsPage />,
  '/suppliers': <SuppliersPage />,
  '/customers': <CustomersPage />,
  '/purchase-orders': <PurchaseOrdersPage />,
  '/receiving': <ReceivingPage />,
  '/orders': <OrdersPage />,
  '/invoices': <InvoicesPage />,
  '/breakages': <BreakagesPage />,
  '/empties': <EmptiesPage />,
  '/vans': <VansPage />,
  '/stocktake': <StocktakePage />,
  '/reports': <ReportsPage />,
  '/users': <UsersPage />,
  '/audit-log': <AuditLogPage />,
};

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin fullscreen />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { can } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/print/invoice/:id"
        element={
          <Protected>
            <InvoicePrint />
          </Protected>
        }
      />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        {MENU.map((m) => (
          <Route
            key={m.path}
            path={m.path}
            element={
              m.roles.length === 0 || can(...m.roles) ? (
                PAGES[m.path] ?? <ComingSoon entry={m} />
              ) : (
                <Result status="403" title="Not allowed" subTitle="Your role cannot use this screen." />
              )
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export default function App() {
  return (
    <ConfigProvider
      theme={{
        // On touch screens (tablets) buttons and fields are a finger's height.
        token: { colorPrimary: '#1f6feb', borderRadius: 6, ...(TOUCH ? { controlHeight: 40, controlHeightSM: 30 } : {}) },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}
