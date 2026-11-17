import { Button, Card, Col, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import { DollarOutlined, PrinterOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, date } from '../../format';
import PaymentModal, { PaymentTarget } from './PaymentModal';

/** FR10 - invoices, what is still owed, and recording payments (Accountant's view). */
export default function InvoicesPage() {
  const [unpaidOnly, setUnpaidOnly] = useState('Unpaid');
  const [rows, setRows] = useState<any[]>([]);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const { can } = useAuth();

  const load = (f = unpaidOnly) => get(`/invoices${f === 'Unpaid' ? '?unpaid=true' : ''}`).then(setRows);
  useEffect(() => void load(), []);

  const owed = rows.reduce((s, r) => s + r.outstanding, 0);
  const overdue = rows.filter((r) => r.days_overdue > 0);

  return (
    <Card>
      <Typography.Title level={4}>Invoices and payments</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Owed to BESH (shown invoices)" value={cedi(owed)} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Overdue invoices" value={overdue.length} valueStyle={{ color: overdue.length ? '#cf1322' : undefined }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Overdue amount" value={cedi(overdue.reduce((s, r) => s + r.outstanding, 0))} />
          </Card>
        </Col>
      </Row>
      <Segmented
        options={['Unpaid', 'All']}
        value={unpaidOnly}
        onChange={(v) => {
          setUnpaidOnly(v as string);
          load(v as string);
        }}
        style={{ marginBottom: 16 }}
      />
      <Table
        rowKey="invoice_id"
        dataSource={rows}
        columns={[
          { title: 'Invoice', dataIndex: 'invoice_no' },
          { title: 'Customer', dataIndex: 'customer_name' },
          { title: 'Date', dataIndex: 'invoice_date', render: date },
          {
            title: 'Due',
            dataIndex: 'due_date',
            render: (d: string, r: any) => (
              <Space>
                {date(d)}
                {r.days_overdue > 0 && <Tag color="red">{r.days_overdue} days overdue</Tag>}
              </Space>
            ),
          },
          { title: 'Total', dataIndex: 'total_amount', align: 'right', render: cedi },
          { title: 'Paid', dataIndex: 'amount_paid', align: 'right', render: cedi },
          {
            title: 'Outstanding',
            dataIndex: 'outstanding',
            align: 'right',
            render: (o: number) => (o > 0 ? <strong>{cedi(o)}</strong> : <Tag color="green">Paid</Tag>),
          },
          {
            title: '',
            key: 'act',
            width: 190,
            render: (_, r: any) => (
              <Space>
                {r.outstanding > 0 && can('ACCOUNTANT', 'SALES_REP', 'DRIVER') && (
                  <Button
                    size="small"
                    icon={<DollarOutlined />}
                    onClick={() =>
                      setPayTarget({
                        customer_id: r.customer_id,
                        customer_name: r.customer_name,
                        invoice_id: r.invoice_id,
                        invoice_no: r.invoice_no,
                        outstanding: r.outstanding,
                      })
                    }
                  >
                    Pay
                  </Button>
                )}
                <Button size="small" icon={<PrinterOutlined />} onClick={() => window.open(`/print/invoice/${r.invoice_id}`, '_blank')}>
                  Print
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <PaymentModal
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onPaid={() => {
          setPayTarget(null);
          load();
        }}
      />
    </Card>
  );
}
