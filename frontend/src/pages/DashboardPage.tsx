import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const cedi = (n: number) => `GH₵ ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** UC8 - first version of the management dashboard. Grows in Phase 5. */
export default function DashboardPage() {
  const { user, can } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [valuation, setValuation] = useState<any[]>([]);

  useEffect(() => {
    get('/stock/near-expiry').then(setExpiring);
    if (can('WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT')) get('/stock/reorder-alerts').then(setAlerts);
    if (can('WAREHOUSE_MANAGER', 'ACCOUNTANT', 'MANAGEMENT')) get('/stock/valuation').then(setValuation);
  }, []);

  const totalCost = valuation.reduce((s, r) => s + r.value_at_cost, 0);
  const totalSell = valuation.reduce((s, r) => s + r.value_at_selling, 0);

  return (
    <>
      <Typography.Title level={3}>Welcome, {user?.fullName.split(' ')[0]}</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {can('WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT') && (
          <Col xs={24} md={6}>
            <Card>
              <Statistic title="Products to reorder" value={alerts.length} valueStyle={{ color: alerts.length ? '#cf1322' : undefined }} />
            </Card>
          </Col>
        )}
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="Batches expiring in 30 days" value={expiring.length} />
          </Card>
        </Col>
        {can('WAREHOUSE_MANAGER', 'ACCOUNTANT', 'MANAGEMENT') && (
          <>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Stock value at cost" value={cedi(totalCost)} />
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Stock value at selling price" value={cedi(totalSell)} />
              </Card>
            </Col>
          </>
        )}
      </Row>

      {can('WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT') && (
        <Card title="Reorder alerts" style={{ marginBottom: 16 }}>
          <Table
            rowKey="product_id"
            size="small"
            pagination={false}
            dataSource={alerts}
            locale={{ emptyText: 'All products are above their reorder level' }}
            columns={[
              { title: 'SKU', dataIndex: 'sku' },
              { title: 'Product', dataIndex: 'product_name' },
              { title: 'In warehouse', dataIndex: 'warehouse_qty', align: 'right' },
              { title: 'Reorder level', dataIndex: 'reorder_level', align: 'right' },
              { title: 'Supplier', dataIndex: 'supplier_name' },
            ]}
          />
        </Card>
      )}

      <Card title="Stock nearing expiry">
        <Table
          rowKey="batch_id"
          size="small"
          pagination={false}
          dataSource={expiring}
          locale={{ emptyText: 'No stock expires in the next 30 days' }}
          columns={[
            { title: 'Product', dataIndex: 'product_name' },
            { title: 'Batch', dataIndex: 'batch_no' },
            { title: 'Location', dataIndex: 'location_name' },
            { title: 'Expiry', dataIndex: 'expiry_date', render: (d: string) => d?.slice(0, 10) },
            { title: 'Qty', dataIndex: 'qty_on_hand', align: 'right' },
            {
              title: 'Status',
              dataIndex: 'expiry_status',
              render: (s: string) => <Tag color={s === 'EXPIRED' ? 'red' : 'orange'}>{s.replace('_', ' ')}</Tag>,
            },
          ]}
        />
      </Card>
    </>
  );
}
