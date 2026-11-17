import { Badge, Card, Col, Empty, List, Row, Statistic, Table, Tag, Typography } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api/client';
import { Role, useAuth } from '../auth/AuthContext';
import { DailySalesChart, RankedBarChart } from '../charts';
import { cedi } from '../format';

interface PendingItem {
  key: string;
  label: string;
  path: string;
  roles: Role[];
}

/** Things waiting for someone, shown to the roles that can act on them. */
const PENDING: PendingItem[] = [
  { key: 'credit_approvals', label: 'Orders waiting for credit approval', path: '/orders', roles: ['ACCOUNTANT'] },
  { key: 'orders_to_invoice', label: 'Confirmed orders to invoice', path: '/orders', roles: ['SALES_REP', 'ACCOUNTANT', 'STORE_KEEPER', 'WAREHOUSE_MANAGER'] },
  { key: 'orders_to_deliver', label: 'Invoiced orders to deliver', path: '/orders', roles: ['DRIVER', 'STORE_KEEPER', 'SALES_REP'] },
  { key: 'write_offs', label: 'Write-offs waiting for approval', path: '/breakages', roles: ['WAREHOUSE_MANAGER'] },
  { key: 'pos_to_approve', label: 'Purchase orders waiting for approval', path: '/purchase-orders', roles: ['WAREHOUSE_MANAGER', 'MANAGEMENT'] },
  { key: 'pos_awaiting_delivery', label: 'Purchase orders awaiting delivery', path: '/receiving', roles: ['STORE_KEEPER', 'WAREHOUSE_MANAGER'] },
  { key: 'vans_out', label: 'Vans out to reconcile', path: '/vans', roles: ['STORE_KEEPER', 'WAREHOUSE_MANAGER'] },
  { key: 'counts_open', label: 'Stock counts in progress', path: '/stocktake', roles: ['STORE_KEEPER', 'WAREHOUSE_MANAGER'] },
];

/** UC8 - dashboard: key figures, work waiting for this user, and trends. */
export default function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState<any | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const money = can('WAREHOUSE_MANAGER', 'ACCOUNTANT', 'MANAGEMENT');
  const stockRole = can('WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT');

  useEffect(() => {
    get('/dashboard').then(setD);
    if (stockRole) get('/stock/reorder-alerts').then(setAlerts);
  }, []);

  if (!d) return <Card loading />;
  const k = d.kpi;
  const pending = PENDING.filter((p) => can(...p.roles) && d.pending[p.key] > 0);

  const tile = (title: string, value: string | number, extra?: React.ReactNode, onClick?: () => void, danger = false) => (
    <Col xs={24} sm={12} lg={6}>
      <Card hoverable={!!onClick} onClick={onClick} style={{ height: '100%' }}>
        <Statistic title={title} value={value} valueStyle={danger ? { color: '#cf1322' } : undefined} />
        {extra && <Typography.Text type="secondary">{extra}</Typography.Text>}
      </Card>
    </Col>
  );

  return (
    <>
      <Typography.Title level={3}>Welcome, {user?.fullName.split(' ')[0]}</Typography.Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {tile('Sales today (before tax)', cedi(k.sales_today), `${k.invoices_today} invoice${k.invoices_today === 1 ? '' : 's'}`)}
        {money && tile('Sales this month', cedi(k.sales_month), `Margin ${cedi(k.margin_month)}`)}
        {money && tile('Owed by customers', cedi(k.receivables), k.overdue > 0 ? `${cedi(k.overdue)} overdue` : 'Nothing overdue', () => navigate('/invoices'), k.overdue > 0)}
        {money && tile('Stock value at cost', cedi(k.stock_value), 'Warehouses and vans', () => navigate('/reports'))}
        {stockRole && tile('Products to reorder', k.reorder_count, 'At or below reorder level', () => navigate('/purchase-orders'), k.reorder_count > 0)}
        {stockRole && tile('Batches expiring in 30 days', k.near_expiry_count, 'Sell these first', undefined, k.near_expiry_count > 0)}
        {money && tile('Stock losses this month', cedi(k.losses_month), 'Breakages, shortages, write-offs', () => navigate('/breakages'), k.losses_month > 0)}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={pending.length ? 16 : 24}>
          <Card title="Sales, last 14 days (before tax)">
            <DailySalesChart data={d.sales_last_14_days} />
          </Card>
        </Col>
        {pending.length > 0 && (
          <Col xs={24} lg={8}>
            <Card title="Waiting for you" style={{ height: '100%' }}>
              <List
                dataSource={pending}
                renderItem={(p) => (
                  <List.Item style={{ cursor: 'pointer' }} onClick={() => navigate(p.path)} extra={<RightOutlined />}>
                    <Badge count={d.pending[p.key]} style={{ marginRight: 12 }} />
                    {p.label}
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        )}
      </Row>

      {money && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={12}>
            <Card title="Top 5 products by revenue (all invoices)">
              {d.top_products.length ? <RankedBarChart data={d.top_products} labelKey="product_name" valueKey="revenue" /> : <Empty />}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="Stock value at cost by category">
              <RankedBarChart data={d.stock_by_category} labelKey="category_name" valueKey="value_at_cost" />
            </Card>
          </Col>
        </Row>
      )}

      {stockRole && (
        <Card title="Reorder alerts">
          <Table
            rowKey="product_id"
            size="small"
            pagination={false}
            dataSource={alerts}
            locale={{ emptyText: 'All products are above their reorder level' }}
            columns={[
              { title: 'SKU', dataIndex: 'sku' },
              { title: 'Product', dataIndex: 'product_name' },
              { title: 'In warehouse', dataIndex: 'warehouse_qty', align: 'right', render: (q: number) => <Tag color="red">{q}</Tag> },
              { title: 'Reorder level', dataIndex: 'reorder_level', align: 'right' },
              { title: 'Supplier', dataIndex: 'supplier_name' },
            ]}
          />
        </Card>
      )}
    </>
  );
}
