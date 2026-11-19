import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Tag, Typography, message } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, date, dateTime } from '../../format';
import { DocumentTimeline } from '../../history';

const REASONS: Record<string, string> = {
  BROKEN: 'Broken',
  LEAKING: 'Leaking',
  EXPIRED: 'Expired',
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  THEFT: 'Theft / missing',
  OTHER: 'Other',
};
const STATUS: Record<string, { label: string; color: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', color: 'gold' },
  APPROVED: { label: 'Written off', color: 'red' },
  REJECTED: { label: 'Rejected', color: 'default' },
};

/** UC3 - breakages, leaks, expiries and losses, with manager approval above a limit. */
export default function BreakagesPage() {
  const { user, can } = useAuth();
  const [filter, setFilter] = useState(can('WAREHOUSE_MANAGER') ? 'Awaiting approval' : 'All');
  const [rows, setRows] = useState<any[]>([]);
  const [limit, setLimit] = useState(0);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const locationId = Form.useWatch('location_id', form);
  const productId = Form.useWatch('product_id', form);
  const batchId = Form.useWatch('batch_id', form);
  const qty = Form.useWatch('quantity', form) ?? 0;

  const load = (f = filter) => get(`/write-offs${f === 'Awaiting approval' ? '?status=PENDING_APPROVAL' : ''}`).then(setRows);

  useEffect(() => {
    load();
    get('/write-offs/settings').then((s) => setLimit(s.approval_limit));
    Promise.all([get('/locations'), get('/products'), get('/staff')]).then(([l, p, s]) => {
      setLocations(l.filter((x: any) => x.location_type === 'WAREHOUSE'));
      setProducts(p);
      setStaff(s);
    });
  }, []);

  useEffect(() => {
    form.setFieldValue('batch_id', undefined);
    if (!productId || !locationId) return setBatches([]);
    get(`/products/${productId}`).then((p) =>
      setBatches(
        p.batches.filter((b: any) => b.qty_on_hand > 0 && b.location_name === locations.find((l) => l.location_id === locationId)?.location_name),
      ),
    );
  }, [productId, locationId]);

  const product = products.find((p) => p.product_id === productId);
  const batch = batches.find((b) => b.batch_id === batchId);
  const value = (product?.cost_price ?? 0) * qty;

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const wo = await post('/write-offs', {
        batch_id: v.batch_id,
        quantity: v.quantity,
        reason_code: v.reason_code,
        description: v.description,
        responsible_user_id: v.responsible_user_id || undefined,
      });
      message.success(wo.status === 'APPROVED' ? `${wo.write_off_no} written off` : `${wo.write_off_no} sent for approval`);
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id: number, action: 'approve' | 'reject', note?: string) => {
    try {
      const wo = await post(`/write-offs/${id}/${action}`, note ? { note } : {});
      message.success(`${wo.write_off_no} ${action === 'approve' ? 'approved and written off' : 'rejected'}`);
      setRejecting(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Breakages and write-offs
        </Typography.Title>
        {can('STORE_KEEPER', 'WAREHOUSE_MANAGER') && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ location_id: 1 });
              setOpen(true);
            }}
          >
            Record write-off
          </Button>
        )}
      </Space>
      <Typography.Paragraph type="secondary">
        Write-offs up to {cedi(limit)} (at cost) are posted at once. Above that, a Warehouse Manager who did not record it must approve.
      </Typography.Paragraph>
      <Segmented
        options={['Awaiting approval', 'All']}
        value={filter}
        onChange={(f) => {
          setFilter(f as string);
          load(f as string);
        }}
        style={{ marginBottom: 16 }}
      />
      <Table
        rowKey="write_off_id"
        dataSource={rows}
        expandable={{
          expandedRowRender: (r: any) => (
            <Typography.Text type="secondary">
              {r.description}
              {r.responsible_name && ` · Responsible: ${r.responsible_name}`}
              {r.decided_by_name && ` · Decided by ${r.decided_by_name} on ${dateTime(r.decided_at)}`}
              {r.decision_note && ` · "${r.decision_note}"`}
              <div style={{ marginTop: 12 }}>
                <DocumentTimeline doc="write-offs" id={r.write_off_id} refreshKey={r.status} />
              </div>
            </Typography.Text>
          ),
        }}
        columns={[
          { title: 'No.', dataIndex: 'write_off_no', className: 'nowrap' },
          { title: 'Recorded', responsive: ['sm'], dataIndex: 'recorded_at', render: dateTime },
          { title: 'Product', dataIndex: 'product_name' },
          { title: 'Batch', responsive: ['md'], render: (_, r: any) => `${r.batch_no} (exp. ${date(r.expiry_date)})` },
          { title: 'Where', responsive: ['md'], dataIndex: 'location_name' },
          { title: 'Qty', dataIndex: 'quantity', align: 'right' },
          { title: 'Reason', responsive: ['sm'], dataIndex: 'reason_code', render: (c: string) => REASONS[c] },
          { title: 'Value', dataIndex: 'write_off_value', align: 'right', render: cedi },
          { title: 'By', responsive: ['lg'], dataIndex: 'recorded_by_name' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag> },
          {
            title: '',
            key: 'act',
            render: (_, r: any) =>
              r.status === 'PENDING_APPROVAL' &&
              can('WAREHOUSE_MANAGER') &&
              r.recorded_by !== user?.userId && (
                <Space>
                  <Popconfirm title={`Write off ${r.quantity} × ${r.product_name}?`} onConfirm={() => decide(r.write_off_id, 'approve')}>
                    <Button size="small" type="primary" icon={<CheckOutlined />}>
                      Approve
                    </Button>
                  </Popconfirm>
                  <Button size="small" icon={<CloseOutlined />} onClick={() => (setRejectNote(''), setRejecting(r))}>
                    Reject
                  </Button>
                </Space>
              ),
          },
        ]}
      />

      <Modal open={open} title="Record write-off" okText="Record" confirmLoading={saving} onOk={save} onCancel={() => setOpen(false)} width={600} destroyOnClose>
        <Form form={form} layout="vertical" requiredMark="optional">
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="location_id" label="Where" rules={[{ required: true }]}>
              <Select options={locations.map((l) => ({ value: l.location_id, label: l.location_name }))} />
            </Form.Item>
            <Form.Item name="product_id" label="Product" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={products.map((p) => ({ value: p.product_id, label: p.product_name }))} />
            </Form.Item>
          </Space>
          <Form.Item name="batch_id" label="Batch" rules={[{ required: true }]}>
            <Select
              placeholder={productId ? (batches.length ? 'Choose the batch' : 'No stock of this product here') : 'Choose a product first'}
              options={batches.map((b) => ({ value: b.batch_id, label: `${b.batch_no} · expires ${date(b.expiry_date)} · ${b.qty_on_hand} on hand` }))}
            />
          </Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item
              name="quantity"
              label="Quantity"
              rules={[{ required: true }, { type: 'number', max: batch?.qty_on_hand, message: `Only ${batch?.qty_on_hand} in this batch` }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="reason_code" label="Reason" rules={[{ required: true }]}>
              <Select options={Object.entries(REASONS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="What happened" rules={[{ required: true }]}>
            <Input.TextArea rows={2} maxLength={200} placeholder="e.g. Crate slipped while loading Van 1" />
          </Form.Item>
          <Form.Item name="responsible_user_id" label="Person responsible (if any)">
            <Select allowClear showSearch optionFilterProp="label" options={staff.map((s) => ({ value: s.user_id, label: s.full_name }))} />
          </Form.Item>
        </Form>
        {qty > 0 && product && (
          <Alert
            type={value > limit ? 'warning' : 'info'}
            showIcon
            message={`Value at cost: ${cedi(value)}`}
            description={value > limit ? 'Above the limit: a Warehouse Manager must approve before the stock is written off.' : 'Within the limit: it will be written off immediately.'}
          />
        )}
      </Modal>

      <Modal
        open={!!rejecting}
        title={`Reject ${rejecting?.write_off_no ?? ''}`}
        okText="Reject"
        okButtonProps={{ danger: true, disabled: !rejectNote.trim() }}
        onOk={() => decide(rejecting.write_off_id, 'reject', rejectNote)}
        onCancel={() => setRejecting(null)}
      >
        <Input.TextArea rows={3} placeholder="Why? e.g. Stock found in another bay" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
      </Modal>
    </Card>
  );
}
