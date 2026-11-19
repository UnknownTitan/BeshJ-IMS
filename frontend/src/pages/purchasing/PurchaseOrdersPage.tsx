import { Badge, Button, Card, Segmented, Space, Table, Tag, Typography } from 'antd';
import { BulbOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { PO_STATUS_COLORS, cedi, date } from '../../format';
import PurchaseOrderDetail from './PurchaseOrderDetail';
import PurchaseOrderForm, { PoDraft } from './PurchaseOrderForm';
import ReorderSuggestions from './ReorderSuggestions';

const FILTERS: Record<string, string> = {
  Open: 'DRAFT,APPROVED,SENT,PARTIAL',
  'Awaiting approval': 'DRAFT',
  'Awaiting delivery': 'APPROVED,SENT,PARTIAL',
  Received: 'RECEIVED',
  Cancelled: 'CANCELLED',
  All: '',
};

/** UC2 - purchase orders: raise, approve, send, track deliveries. */
export default function PurchaseOrdersPage() {
  const [filter, setFilter] = useState('Open');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<PoDraft | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const { can } = useAuth();
  const navigate = useNavigate();
  const isManager = can('WAREHOUSE_MANAGER');

  const load = (f = filter) => {
    setLoading(true);
    get(`/purchase-orders${FILTERS[f] ? `?status=${FILTERS[f]}` : ''}`)
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (isManager) get('/purchase-orders/suggestions').then((s) => setAlertCount(s.filter((x: any) => x.suggested_qty > 0).length));
  }, []);

  const open = (id: number) => get(`/purchase-orders/${id}`).then(setSelected);

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Purchase orders
        </Typography.Title>
        {isManager && (
          <Space>
            <Badge count={alertCount}>
              <Button icon={<BulbOutlined />} onClick={() => setSuggestOpen(true)}>
                Reorder suggestions
              </Button>
            </Badge>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ lines: [] })}>
              New order
            </Button>
          </Space>
        )}
      </Space>

      <Segmented
        options={Object.keys(FILTERS)}
        value={filter}
        onChange={(f) => {
          setFilter(f as string);
          load(f as string);
        }}
        style={{ marginBottom: 16 }}
      />

      <Table
        rowKey="po_id"
        loading={loading}
        dataSource={rows}
        onRow={(r) => ({ onClick: () => open(r.po_id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'PO number', dataIndex: 'po_no', className: 'nowrap' },
          { title: 'Supplier', dataIndex: 'supplier_name' },
          { title: 'Order date', responsive: ['sm'], dataIndex: 'po_date', render: date },
          { title: 'Expected', responsive: ['md'], dataIndex: 'expected_date', render: date },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={PO_STATUS_COLORS[s]}>{s}</Tag> },
          { title: 'Products', responsive: ['md'], dataIndex: 'line_count', align: 'right' },
          { title: 'Value', dataIndex: 'total_value', align: 'right', render: cedi },
          { title: 'Raised by', responsive: ['lg'], dataIndex: 'created_by_name' },
        ]}
      />

      <PurchaseOrderDetail
        po={selected}
        onClose={() => setSelected(null)}
        onChanged={(po) => {
          setSelected(po);
          load();
        }}
        onEdit={(po) =>
          setDraft({
            po_id: po.po_id,
            supplier_id: po.supplier_id,
            expected_date: po.expected_date,
            lines: po.lines.map((l: any) => ({ product_id: l.product_id, quantity: l.qty_ordered, unit_cost: l.unit_cost })),
          })
        }
        onReceive={(po) => navigate(`/receiving?po=${po.po_id}`)}
      />

      <PurchaseOrderForm
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={(po) => {
          setDraft(null);
          setSelected(po);
          load();
        }}
      />

      <ReorderSuggestions
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onCreate={(d) => {
          setSuggestOpen(false);
          setDraft(d);
        }}
      />
    </Card>
  );
}
