import { Button, Card, Checkbox, Segmented, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ORDER_STATUS, cedi, date } from '../../format';
import OrderDetail from './OrderDetail';
import OrderForm, { OrderDraft } from './OrderForm';

const FILTERS: Record<string, string> = {
  Open: 'DRAFT,PENDING_CREDIT_APPROVAL,CONFIRMED,PICKING,LOADED_ON_VAN,DELIVERED',
  'Credit approval': 'PENDING_CREDIT_APPROVAL',
  'To invoice': 'CONFIRMED',
  'To deliver': 'PICKING,LOADED_ON_VAN',
  Unpaid: 'DELIVERED,OVERDUE',
  Paid: 'PAID',
  Cancelled: 'CANCELLED',
  All: '',
};

/** UC9 - customer orders from draft to paid. */
export default function OrdersPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState(can('ACCOUNTANT') ? 'Credit approval' : 'Open');
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const canCreate = can('SALES_REP', 'WAREHOUSE_MANAGER', 'ACCOUNTANT');

  const load = (f = filter, m = mine) => {
    setLoading(true);
    const q = new URLSearchParams();
    if (FILTERS[f]) q.set('status', FILTERS[f]);
    if (m) q.set('mine', 'true');
    get(`/orders?${q}`)
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);
  const open = (id: number) => get(`/orders/${id}`).then(setSelected);

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Customer orders
        </Typography.Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ lines: [] })}>
            New order
          </Button>
        )}
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          options={Object.keys(FILTERS)}
          value={filter}
          onChange={(f) => {
            setFilter(f as string);
            load(f as string);
          }}
        />
        {can('SALES_REP') && (
          <Checkbox
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              load(filter, e.target.checked);
            }}
          >
            My orders only
          </Checkbox>
        )}
      </Space>
      <Table
        rowKey="order_id"
        loading={loading}
        dataSource={rows}
        onRow={(r) => ({ onClick: () => open(r.order_id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Order', dataIndex: 'order_no', className: 'nowrap' },
          { title: 'Date', dataIndex: 'order_date', render: date },
          { title: 'Customer', dataIndex: 'customer_name', onCell: () => ({ style: { minWidth: 170 } }) },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: string) => <Tag color={ORDER_STATUS[s]?.color}>{ORDER_STATUS[s]?.label ?? s}</Tag>,
          },
          { title: 'Invoice', dataIndex: 'invoice_no', className: 'nowrap', responsive: ['lg'], render: (n: string | null) => n ?? '—' },
          {
            title: 'Value',
            align: 'right',
            render: (_, r: any) => cedi(r.total_amount ?? r.subtotal),
          },
          {
            title: 'Outstanding',
            dataIndex: 'outstanding',
            align: 'right',
            render: (o: number | null) => (o == null ? '—' : o > 0 ? <span style={{ color: '#cf1322' }}>{cedi(o)}</span> : cedi(0)),
          },
          { title: 'Sales rep', dataIndex: 'sales_rep_name', responsive: ['lg'] },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Value before invoicing is the subtotal; after invoicing it is the invoice total including tax and deposits.
      </Typography.Text>

      <OrderDetail
        order={selected}
        onClose={() => setSelected(null)}
        onChanged={(o) => {
          setSelected(o);
          load();
        }}
        onEdit={(o) =>
          setDraft({
            order_id: o.order_id,
            customer_id: o.customer_id,
            lines: o.lines.map((l: any) => ({ product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price })),
          })
        }
      />
      <OrderForm
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={(o) => {
          setDraft(null);
          setSelected(o);
          load();
        }}
      />
    </Card>
  );
}
