import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  CarOutlined,
  ContactsOutlined,
  DashboardOutlined,
  DollarOutlined,
  ShopOutlined,
  InboxOutlined,
  ReconciliationOutlined,
  RetweetOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { ReactNode } from 'react';
import { Role } from '../auth/AuthContext';

export interface MenuEntry {
  path: string;
  label: string;
  icon: ReactNode;
  /** Roles that see this item. ADMIN always does. Empty = everyone. */
  roles: Role[];
  /** Use case from the SAD documentation. */
  useCase?: string;
  /** Phase in which the screen is built (roadmap). Phase 0 = available now. */
  phase: number;
}

// One list drives both the sidebar and the routes, so access rules live in one place.
export const MENU: MenuEntry[] = [
  { path: '/', label: 'Dashboard', icon: <DashboardOutlined />, roles: [], phase: 0, useCase: 'UC8' },
  { path: '/products', label: 'Products', icon: <AppstoreOutlined />, roles: [], phase: 0, useCase: 'UC1' },
  { path: '/suppliers', label: 'Suppliers', icon: <ShopOutlined />, roles: ['WAREHOUSE_MANAGER', 'STORE_KEEPER', 'ACCOUNTANT', 'MANAGEMENT'], phase: 1 },
  { path: '/customers', label: 'Customers', icon: <ContactsOutlined />, roles: ['SALES_REP', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'MANAGEMENT', 'DRIVER'], phase: 1, useCase: 'UC9' },
  { path: '/purchase-orders', label: 'Purchase orders', icon: <ShoppingOutlined />, roles: ['WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT', 'ACCOUNTANT'], phase: 2, useCase: 'UC2' },
  { path: '/receiving', label: 'Receive stock', icon: <InboxOutlined />, roles: ['STORE_KEEPER', 'WAREHOUSE_MANAGER'], phase: 2, useCase: 'UC5' },
  { path: '/orders', label: 'Customer orders', icon: <ShoppingCartOutlined />, roles: ['SALES_REP', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT', 'DRIVER'], phase: 3, useCase: 'UC9' },
  { path: '/invoices', label: 'Invoices & payments', icon: <DollarOutlined />, roles: ['ACCOUNTANT', 'SALES_REP', 'MANAGEMENT', 'WAREHOUSE_MANAGER'], phase: 3, useCase: 'UC9' },
  { path: '/breakages', label: 'Breakages & write-offs', icon: <WarningOutlined />, roles: ['WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT', 'ACCOUNTANT'], phase: 4, useCase: 'UC3' },
  { path: '/empties', label: 'Empties & deposits', icon: <RetweetOutlined />, roles: ['STORE_KEEPER', 'DRIVER', 'ACCOUNTANT', 'SALES_REP', 'WAREHOUSE_MANAGER', 'MANAGEMENT'], phase: 4, useCase: 'UC7' },
  { path: '/vans', label: 'Vans', icon: <CarOutlined />, roles: ['STORE_KEEPER', 'DRIVER', 'WAREHOUSE_MANAGER', 'SALES_REP', 'MANAGEMENT', 'ACCOUNTANT'], phase: 4, useCase: 'UC6' },
  { path: '/stocktake', label: 'Stocktake', icon: <ReconciliationOutlined />, roles: ['WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT', 'ACCOUNTANT'], phase: 4, useCase: 'UC4' },
  { path: '/reports', label: 'Reports', icon: <BarChartOutlined />, roles: ['WAREHOUSE_MANAGER', 'ACCOUNTANT', 'MANAGEMENT'], phase: 5, useCase: 'UC8' },
  { path: '/users', label: 'Users', icon: <TeamOutlined />, roles: ['ADMIN'], phase: 0, useCase: 'UC10' },
  { path: '/audit-log', label: 'Audit trail', icon: <AuditOutlined />, roles: ['MANAGEMENT'], phase: 0, useCase: 'UC10' },
];
