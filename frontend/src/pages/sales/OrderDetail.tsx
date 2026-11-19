import { Alert, Button, Descriptions, Drawer, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import {
  CarOutlined,
  CheckOutlined,
  CloseOutlined,
  DollarOutlined,
  EditOutlined,
  FileDoneOutlined,
  PrinterOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ORDER_STATUS, PAYMENT_METHODS, cedi, date, dateTime } from '../../format';
import PaymentModal, { PaymentTarget } from './PaymentModal';
import { DocumentTimeline } from '../../history';

interface Props {
  order: any | null;
  onClose: () => void;
  onChanged: (o: any) => void;
  onEdit: (o: any) => void;
}

/** One customer order and the next step allowed for its status and the user's role. */
export default function OrderDetail({ order, onClose, onChanged, onEdit }: Props) {
  const { user, can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [vanOpen, setVanOpen] = useState(false);
  const [vans, setVans] = useState<any[]>([]);
  const [vanId, setVanId] = useState<number | undefined>();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [source, setSource] = useState<number>(0);
  const [vansOut, setVansOut] = useState<any[]>([]);

  useEffect(() => {
    get('/locations').then((l) => setVans(l.filter((x: any) => x.location_type === 'VAN')));
    get('/vans').then((v) => setVansOut(v.filter((x: any) => x.open_trip_id)));
  }, []);

  const act = async (action: string, label: string, body: object = {}) => {
    setBusy(action);
    try {
      const o = await post(`/orders/${order.order_id}/${action}`, body);
      message.success(`${o.order_no} ${label}`);
      onChanged(o);
      return o;
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const reload = () => get(`/orders/${order.order_id}`).then(onChanged);

  if (!order) return <Drawer open={false} />;
  const s = order.status;
  const st = ORDER_STATUS[s] ?? { label: s, color: 'default' };
  const inv = order.invoice;
  const t = order.totals;

  return (
    <Drawer
      width={920}
      open={!!order}
      onClose={onClose}
      title={
        <Space>
          {order.order_no}
          <Tag color={st.color}>{st.label}</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          {s === 'DRAFT' && can('SALES_REP', 'WAREHOUSE_MANAGER', 'ACCOUNTANT') && (
            <>
              <Button icon={<EditOutlined />} onClick={() => onEdit(order)}>
                Edit
              </Button>
              <Button type="primary" icon={<SendOutlined />} loading={busy === 'submit'} onClick={() => act('submit', 'submitted')}>
                Submit
              </Button>
            </>
          )}
          {s === 'PENDING_CREDIT_APPROVAL' && can('ACCOUNTANT') && order.sales_rep_id !== user?.userId && (
            <Button type="primary" icon={<CheckOutlined />} loading={busy === 'approve-credit'} onClick={() => act('approve-credit', 'credit approved')}>
              Approve credit
            </Button>
          )}
          {s === 'CONFIRMED' && can('SALES_REP', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'STORE_KEEPER') && (
            <Button type="primary" icon={<FileDoneOutlined />} onClick={() => (setSource(0), setInvoiceOpen(true))}>
              Issue invoice
            </Button>
          )}
          {['PICKING', 'LOADED_ON_VAN'].includes(s) && can('SALES_REP', 'DRIVER', 'STORE_KEEPER', 'WAREHOUSE_MANAGER') && (
            <Button icon={<CarOutlined />} onClick={() => (setVanId(order.van_id ?? undefined), setVanOpen(true))}>
              Mark delivered
            </Button>
          )}
          {inv && inv.outstanding > 0 && can('ACCOUNTANT', 'SALES_REP', 'DRIVER') && (
            <Button
              icon={<DollarOutlined />}
              onClick={() =>
                setPayTarget({
                  customer_id: order.customer_id,
                  customer_name: order.customer_name,
                  invoice_id: inv.invoice_id,
                  invoice_no: inv.invoice_no,
                  outstanding: inv.outstanding,
                })
              }
            >
              Record payment
            </Button>
          )}
          {inv && (
            <Button icon={<PrinterOutlined />} onClick={() => window.open(`/print/invoice/${inv.invoice_id}`, '_blank')}>
              Print invoice
            </Button>
          )}
          {['DRAFT', 'PENDING_CREDIT_APPROVAL', 'CONFIRMED'].includes(s) && can('SALES_REP', 'WAREHOUSE_MANAGER', 'ACCOUNTANT') && (
            <Popconfirm title="Cancel this order?" onConfirm={() => act('cancel', 'cancelled')}>
              <Button danger icon={<CloseOutlined />} loading={busy === 'cancel'}>
                Cancel
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      {s === 'PENDING_CREDIT_APPROVAL' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Over the credit limit"
          description={`${order.customer_name} owes ${cedi(order.customer_balance)} with a limit of ${cedi(order.credit_limit)}. This order adds ${cedi(t.total)}. An Accountant must approve it before it can be invoiced.`}
        />
      )}

      <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Customer">{order.customer_name}</Descriptions.Item>
        <Descriptions.Item label="Phone · GPS">
          {order.customer_phone} · {order.gps_address}
        </Descriptions.Item>
        <Descriptions.Item label="Terms">
          {order.payment_terms}
          {order.payment_terms === 'CREDIT' && ` · limit ${cedi(order.credit_limit)}`}
        </Descriptions.Item>
        <Descriptions.Item label="Balance owed (all invoices)">{cedi(order.customer_balance)}</Descriptions.Item>
        <Descriptions.Item label="Order date">{dateTime(order.order_date)}</Descriptions.Item>
        <Descriptions.Item label="Sales rep">{order.sales_rep_name}</Descriptions.Item>
        {order.credit_approved_by_name && <Descriptions.Item label="Credit approved by">{order.credit_approved_by_name}</Descriptions.Item>}
        {order.van_name && <Descriptions.Item label="Delivered by">{`${order.van_name} (${order.vehicle_reg})`}</Descriptions.Item>}
      </Descriptions>

      <Table
        size="small"
        rowKey="line_no"
        pagination={false}
        dataSource={order.lines}
        columns={[
          { title: 'Product', dataIndex: 'product_name' },
          { title: 'Qty', dataIndex: 'quantity', align: 'right' },
          { title: 'Unit price', dataIndex: 'unit_price', align: 'right', render: cedi },
          { title: 'Amount', dataIndex: 'line_total', align: 'right', render: cedi },
          {
            title: 'Containers',
            render: (_, l: any) => (l.containers ? `${l.containers} × ${l.container_name}` : '—'),
          },
          { title: 'Deposit', dataIndex: 'deposit', align: 'right', render: (d: number) => (d ? cedi(d) : '—') },
        ]}
      />
      <Descriptions size="small" column={1} bordered style={{ marginTop: 16, maxWidth: 380, marginLeft: 'auto' }}>
        <Descriptions.Item label="Subtotal">{cedi(t.subtotal)}</Descriptions.Item>
        <Descriptions.Item label={`Tax ${t.tax_rate}%`}>{cedi(t.tax)}</Descriptions.Item>
        <Descriptions.Item label="Container deposit">{cedi(t.deposit)}</Descriptions.Item>
        <Descriptions.Item label={<strong>Total</strong>}>
          <strong>{cedi(t.total)}</strong>
        </Descriptions.Item>
        {inv && (
          <>
            <Descriptions.Item label="Paid">{cedi(inv.amount_paid)}</Descriptions.Item>
            <Descriptions.Item label={<strong>Outstanding</strong>}>
              <strong style={{ color: inv.outstanding > 0 ? '#cf1322' : undefined }}>{cedi(inv.outstanding)}</strong>
            </Descriptions.Item>
          </>
        )}
      </Descriptions>

      {inv && (
        <>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            Invoice {inv.invoice_no}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            Issued {date(inv.invoice_date)} · due {date(inv.due_date)} · GRA E-VAT code {inv.gra_sdc_code ?? 'not yet signed'}
            {inv.days_overdue > 0 && <Tag color="red" style={{ marginLeft: 8 }}>{inv.days_overdue} days overdue</Tag>}
          </Typography.Paragraph>

          <Typography.Text strong>Stock picked (earliest expiry first)</Typography.Text>
          <Table
            size="small"
            rowKey={(r: any) => `${r.product_id}-${r.batch_no}`}
            pagination={false}
            dataSource={order.picked}
            style={{ marginTop: 8 }}
            locale={{ emptyText: 'Sample invoice: no picking record' }}
            columns={[
              { title: 'Product', dataIndex: 'product_name' },
              { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap' },
              { title: 'Expiry', dataIndex: 'expiry_date', render: date },
              { title: 'Qty', dataIndex: 'quantity', align: 'right' },
            ]}
          />

          <Typography.Text strong style={{ display: 'block', marginTop: 16 }}>
            Payments
          </Typography.Text>
          <Table
            size="small"
            rowKey="payment_id"
            pagination={false}
            dataSource={order.payments}
            style={{ marginTop: 8 }}
            locale={{ emptyText: 'No payments yet' }}
            columns={[
              { title: 'Date', dataIndex: 'payment_date', render: date },
              { title: 'Recorded', dataIndex: 'created_at', render: dateTime },
              { title: 'Method', dataIndex: 'payment_method', render: (m: string) => PAYMENT_METHODS[m] ?? m },
              { title: 'Reference', dataIndex: 'reference' },
              { title: 'Received by', dataIndex: 'received_by_name' },
              { title: 'Amount', dataIndex: 'amount', align: 'right', render: cedi },
            ]}
          />
        </>
      )}

      <Modal
        open={vanOpen}
        title="Mark as delivered"
        okText="Delivered"
        okButtonProps={{ disabled: !vanId, loading: busy === 'deliver' }}
        onCancel={() => setVanOpen(false)}
        onOk={async () => {
          const o = await act('deliver', 'marked as delivered', { van_id: vanId });
          if (o) setVanOpen(false);
        }}
      >
        <Typography.Paragraph>Which van delivered the goods?</Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          value={vanId}
          onChange={setVanId}
          placeholder="Choose a van"
          options={vans.map((v) => ({ value: v.location_id, label: `${v.location_name} (${v.vehicle_reg})${v.driver_name ? ` · ${v.driver_name}` : ''}` }))}
        />
      </Modal>

      <Modal
        open={invoiceOpen}
        title="Issue invoice and take the goods out of stock"
        okText="Issue invoice"
        okButtonProps={{ loading: busy === 'invoice' }}
        onCancel={() => setInvoiceOpen(false)}
        onOk={async () => {
          const o = await act('invoice', 'invoiced', source ? { van_id: source } : {});
          if (o) setInvoiceOpen(false);
        }}
      >
        <Typography.Paragraph>Where are the goods coming from? Stock is picked earliest expiry first. This cannot be undone.</Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          value={source}
          onChange={setSource}
          options={[
            { value: 0, label: 'Main Warehouse - Accra' },
            ...vansOut.map((v) => ({ value: v.van_id, label: `Van sale: ${v.location_name} (${v.open_trip_no}, ${v.units_on_board} units on board)` })),
          ]}
        />
      </Modal>

      <PaymentModal
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onPaid={() => {
          setPayTarget(null);
          reload();
        }}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        History
      </Typography.Title>
      <DocumentTimeline doc="orders" id={order.order_id} refreshKey={`${order.status}-${order.invoice?.amount_paid ?? ''}`} />
    </Drawer>
  );
}
