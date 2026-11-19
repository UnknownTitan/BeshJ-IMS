import { Alert, Button, Descriptions, Drawer, Popconfirm, Space, Table, Tag, Timeline, Typography, message } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, InboxOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { PO_STATUS_COLORS, cedi, date, dateTime } from '../../format';
import { DocumentTimeline } from '../../history';

interface Props {
  po: any | null;
  onClose: () => void;
  onChanged: (po: any) => void;
  onEdit: (po: any) => void;
  onReceive: (po: any) => void;
}

/** One purchase order: its lines, deliveries so far, and the actions allowed for its status and the user's role. */
export default function PurchaseOrderDetail({ po, onClose, onChanged, onEdit, onReceive }: Props) {
  const { user, can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (action: string, label: string) => {
    setBusy(action);
    try {
      const updated = await post(`/purchase-orders/${po.po_id}/${action}`, {});
      message.success(`${updated.po_no} ${label}`);
      onChanged(updated);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!po) return <Drawer open={false} />;

  const s = po.status;
  const isManager = can('WAREHOUSE_MANAGER');
  const total = po.lines.reduce((t: number, l: any) => t + l.line_total, 0);
  const ownOrder = po.created_by === user?.userId;

  return (
    <Drawer
      width={900}
      open={!!po}
      onClose={onClose}
      title={
        <Space>
          {po.po_no}
          <Tag color={PO_STATUS_COLORS[s]}>{s}</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          {s === 'DRAFT' && isManager && (
            <Button icon={<EditOutlined />} onClick={() => onEdit(po)}>
              Edit
            </Button>
          )}
          {s === 'DRAFT' && can('WAREHOUSE_MANAGER', 'MANAGEMENT') && !ownOrder && (
            <Button type="primary" icon={<CheckOutlined />} loading={busy === 'approve'} onClick={() => act('approve', 'approved')}>
              Approve
            </Button>
          )}
          {s === 'APPROVED' && isManager && (
            <Button icon={<SendOutlined />} loading={busy === 'send'} onClick={() => act('send', 'marked as sent')}>
              Mark as sent
            </Button>
          )}
          {['APPROVED', 'SENT', 'PARTIAL'].includes(s) && can('STORE_KEEPER', 'WAREHOUSE_MANAGER') && (
            <Button type="primary" icon={<InboxOutlined />} onClick={() => onReceive(po)}>
              Receive goods
            </Button>
          )}
          {s === 'PARTIAL' && isManager && (
            <Popconfirm
              title="Close this order?"
              description="Stop waiting for the outstanding goods. This cannot be undone."
              onConfirm={() => act('close', 'closed')}
            >
              <Button icon={<StopOutlined />} loading={busy === 'close'}>
                Close short
              </Button>
            </Popconfirm>
          )}
          {['DRAFT', 'APPROVED', 'SENT'].includes(s) && isManager && (
            <Popconfirm title="Cancel this purchase order?" description="This cannot be undone." onConfirm={() => act('cancel', 'cancelled')}>
              <Button danger icon={<CloseOutlined />} loading={busy === 'cancel'}>
                Cancel order
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      {s === 'DRAFT' && ownOrder && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Waiting for approval"
          description="You raised this order, so another manager (Warehouse Manager or Management) must approve it."
        />
      )}

      <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Supplier">{po.supplier_name}</Descriptions.Item>
        <Descriptions.Item label="Supplier contact">{[po.supplier_phone, po.supplier_email].filter(Boolean).join(' · ')}</Descriptions.Item>
        <Descriptions.Item label="Order date">{date(po.po_date)}</Descriptions.Item>
        <Descriptions.Item label="Expected delivery">{date(po.expected_date)}</Descriptions.Item>
        <Descriptions.Item label="Raised by">{po.created_by_name}</Descriptions.Item>
        <Descriptions.Item label="Approved by">{po.approved_by_name ?? '—'}</Descriptions.Item>
      </Descriptions>

      <Table
        size="small"
        rowKey="line_no"
        pagination={false}
        dataSource={po.lines}
        columns={[
          { title: '#', dataIndex: 'line_no', className: 'nowrap', width: 40 },
          { title: 'Product', dataIndex: 'product_name' },
          { title: 'Ordered', dataIndex: 'qty_ordered', align: 'right' },
          { title: 'Received', dataIndex: 'qty_received', align: 'right' },
          { title: 'Damaged', dataIndex: 'qty_damaged', align: 'right', render: (d: number) => (d ? <Tag color="red">{d}</Tag> : 0) },
          {
            title: 'Outstanding',
            dataIndex: 'qty_outstanding',
            align: 'right',
            render: (o: number) => (o && s !== 'RECEIVED' && s !== 'CANCELLED' ? <strong>{o}</strong> : o),
          },
          { title: 'Unit cost', dataIndex: 'unit_cost', align: 'right', render: cedi },
          { title: 'Line total', dataIndex: 'line_total', align: 'right', render: cedi },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={7} align="right">
              <strong>Order total</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <strong>{cedi(total)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Deliveries
      </Typography.Title>
      {po.receipts.length === 0 ? (
        <Typography.Text type="secondary">No goods received yet.</Typography.Text>
      ) : (
        <Timeline
          items={po.receipts.map((r: any) => ({
            color: 'green',
            children: (
              <>
                <Typography.Text strong>{r.grn_no}</Typography.Text> · {dateTime(r.received_at)} · {r.received_by_name} · delivery note{' '}
                {r.delivery_note_no} · {r.location_name}
                {r.notes && <div style={{ color: '#888' }}>{r.notes}</div>}
                <Table
                  size="small"
                  pagination={false}
                  rowKey="line_no"
                  style={{ marginTop: 8 }}
                  dataSource={r.lines}
                  columns={[
                    { title: 'Product', dataIndex: 'product_name' },
                    { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap', render: (b: string | null) => b ?? '—' },
                    { title: 'Expiry', dataIndex: 'expiry_date', render: date },
                    { title: 'Received', dataIndex: 'qty_received', align: 'right' },
                    {
                      title: 'Damaged',
                      dataIndex: 'qty_damaged',
                      align: 'right',
                      render: (d: number, l: any) => (d ? <span title={l.damage_note}>{d} ⚠</span> : 0),
                    },
                  ]}
                />
              </>
            ),
          }))}
        />
      )}

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        History
      </Typography.Title>
      <DocumentTimeline doc="purchase-orders" id={po.po_id} refreshKey={`${po.status}-${po.receipts?.length ?? 0}`} />
    </Drawer>
  );
}
