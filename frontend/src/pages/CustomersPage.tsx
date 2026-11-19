import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { lastChangedColumn, RecordStamp } from '../history';

const cedi = (n: number | null) => (n == null ? '—' : `GH₵\u00a0${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`);
const TYPES = ['RETAILER', 'WHOLESALER', 'BAR', 'RESTAURANT'];

/** Customers with balances. Sales Reps register them; only Accountants set credit terms (FR9). */
export default function CustomersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const terms = Form.useWatch('payment_terms', form);
  const { can } = useAuth();
  const canEdit = can('SALES_REP', 'ACCOUNTANT', 'WAREHOUSE_MANAGER');
  const canSetCredit = can('ACCOUNTANT');

  const load = (q = search) => get(`/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`).then(setRows);
  useEffect(() => void load(''), []);

  const open = (c: any | 'new') => {
    form.resetFields();
    form.setFieldsValue(c === 'new' ? { payment_terms: 'CASH', credit_limit: 0 } : c);
    setEditing(c);
  };

  const save = async () => {
    const values = await form.validateFields();
    if (!values.tin) values.tin = null;
    if (!canSetCredit) {
      delete values.payment_terms;
      delete values.credit_limit;
    } else if (values.payment_terms === 'CASH') values.credit_limit = 0;
    setSaving(true);
    try {
      if (editing === 'new') await post('/customers', values);
      else await patch(`/customers/${editing.customer_id}`, values);
      message.success('Customer saved');
      setEditing(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Customers
        </Typography.Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            New customer
          </Button>
        )}
      </Space>
      <Input.Search
        placeholder="Search by name or phone"
        allowClear
        enterButton
        style={{ maxWidth: 360, marginBottom: 16 }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onSearch={(q) => load(q)}
      />
      <Table
        rowKey="customer_id"
        dataSource={rows}
        columns={[
          { title: 'Customer', dataIndex: 'customer_name' },
          { title: 'Type', responsive: ['md'], dataIndex: 'customer_type', render: (t: string) => <Tag>{t}</Tag> },
          { title: 'Phone', responsive: ['sm'], dataIndex: 'phone' },
          { title: 'GPS address', responsive: ['md'], dataIndex: 'gps_address', className: 'nowrap' },
          {
            title: 'Terms', responsive: ['sm'],
            dataIndex: 'payment_terms',
            render: (t: string) => <Tag color={t === 'CREDIT' ? 'blue' : 'default'}>{t}</Tag>,
          },
          { title: 'Credit limit', responsive: ['sm'], dataIndex: 'credit_limit', align: 'right', render: cedi },
          lastChangedColumn,
          {
            title: 'Balance owed',
            dataIndex: 'balance',
            align: 'right',
            render: (b: number, r) => (r.payment_terms === 'CREDIT' && b > r.credit_limit ? <Tag color="red">{cedi(b)}</Tag> : cedi(b)),
          },
          ...(canEdit
            ? [{ title: '', key: 'edit', width: 60, render: (_: any, r: any) => <Button size="small" icon={<EditOutlined />} onClick={() => open(r)} /> }]
            : []),
        ]}
      />
      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New customer' : 'Edit customer'}
        okText="Save"
        confirmLoading={saving}
        onOk={save}
        onCancel={() => setEditing(null)}
        width={640}
        destroyOnClose
      >
        <RecordStamp entity="customers" id={editing && editing !== 'new' ? editing.customer_id : null} />
        <Form form={form} layout="vertical" requiredMark="optional">
          <Row gutter={12}>
            <Col xs={24} sm={16}>
              <Form.Item name="customer_name" label="Customer name" rules={[{ required: true }]}>
                <Input maxLength={100} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="customer_type" label="Type" rules={[{ required: true }]}>
                <Select options={TYPES.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="contact_person" label="Contact person">
                <Input maxLength={80} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="Phone" rules={[{ required: true }, { pattern: /^\+?[0-9]{9,14}$/, message: '9 to 14 digits' }]}>
                <Input maxLength={15} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="gps_address"
                label="Ghana Post GPS address"
                normalize={(v: string) => v?.toUpperCase()}
                rules={[{ required: true }, { pattern: /^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$/, message: 'Format: GA-183-8164' }]}
              >
                <Input maxLength={15} placeholder="GA-183-8164" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="tin" label="TIN">
                <Input maxLength={15} />
              </Form.Item>
            </Col>
          </Row>
          {!canSetCredit && <Alert type="info" showIcon message="Only an Accountant can change payment terms and credit limits." style={{ marginBottom: 12 }} />}
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="payment_terms" label="Payment terms">
                <Select disabled={!canSetCredit} options={[{ value: 'CASH', label: 'Cash' }, { value: 'CREDIT', label: 'Credit' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="credit_limit" label="Credit limit (GH₵)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canSetCredit || terms !== 'CREDIT'} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}
