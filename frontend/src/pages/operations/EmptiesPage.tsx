import { Button, Card, Col, Form, InputNumber, Modal, Radio, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import { RollbackOutlined, ShopOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, dateTime } from '../../format';

/** UC7 - crates, bottles and kegs customers hold, returns and deposit refunds. */
export default function EmptiesPage() {
  const { can } = useAuth();
  const [positions, setPositions] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [mode, setMode] = useState<null | 'customer' | 'supplier'>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const customerId = Form.useWatch('customer_id', form);

  const load = () => Promise.all([get('/empties/positions'), get('/empties/transactions')]).then(([p, t]) => (setPositions(p), setTxns(t)));
  useEffect(() => {
    load();
    Promise.all([get('/container-types'), get('/customers'), get('/suppliers')]).then(([ct, c, s]) => {
      setContainers(ct);
      setCustomers(c);
      setSuppliers(s);
    });
  }, []);

  const held = positions.filter((p) => p.customer_id === customerId && p.containers_held > 0);

  const openCustomer = (customer?: number) => {
    form.resetFields();
    form.setFieldsValue({ customer_id: customer, refund_method: 'CREDIT', qty: {} });
    setMode('customer');
  };

  const save = async () => {
    const v = await form.validateFields();
    const lines = Object.entries(v.qty ?? {})
      .filter(([, q]) => (q as number) > 0)
      .map(([id, q]) => ({ container_type_id: Number(id), quantity: q }));
    if (!lines.length) return message.warning('Enter at least one quantity');
    setSaving(true);
    try {
      if (mode === 'customer') {
        const r = await post('/empties/returns', { customer_id: v.customer_id, refund_method: v.refund_method, lines });
        message.success(
          r.refund_method === 'CREDIT'
            ? `${cedi(r.deposit_refunded)} credited. New balance ${cedi(r.new_balance)}`
            : `Pay the customer ${cedi(r.deposit_refunded)} in cash`,
        );
      } else {
        const r = await post('/empties/supplier-returns', { supplier_id: v.supplier_id, lines });
        message.success(`Return recorded (deposit value ${cedi(r.deposit_value)})`);
      }
      setMode(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const totalHeld = positions.reduce((s, p) => s + Math.max(p.deposit_held, 0), 0);
  const canRecord = can('STORE_KEEPER', 'DRIVER', 'SALES_REP', 'ACCOUNTANT');

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Empties and deposits
        </Typography.Title>
        <Space>
          {can('STORE_KEEPER', 'WAREHOUSE_MANAGER') && (
            <Button icon={<ShopOutlined />} onClick={() => (form.resetFields(), setMode('supplier'))}>
              Return to supplier
            </Button>
          )}
          {canRecord && (
            <Button type="primary" icon={<RollbackOutlined />} onClick={() => openCustomer()}>
              Customer return
            </Button>
          )}
        </Space>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Deposits held by customers" value={cedi(totalHeld)} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Customers holding containers" value={new Set(positions.filter((p) => p.containers_held > 0).map((p) => p.customer_id)).size} />
          </Card>
        </Col>
      </Row>
      <Tabs
        items={[
          {
            key: 'held',
            label: 'Held by customers',
            children: (
              <Table
                rowKey={(r: any) => `${r.customer_id}-${r.container_type_id}`}
                dataSource={positions}
                pagination={false}
                columns={[
                  { title: 'Customer', dataIndex: 'customer_name' },
                  { title: 'Container', dataIndex: 'container_name' },
                  { title: 'Held', dataIndex: 'containers_held', align: 'right' },
                  { title: 'Deposit each', dataIndex: 'deposit_amount', align: 'right', render: cedi },
                  { title: 'Deposit held', dataIndex: 'deposit_held', align: 'right', render: cedi },
                  {
                    title: '',
                    key: 'act',
                    render: (_, r: any) =>
                      canRecord &&
                      r.containers_held > 0 && (
                        <Button size="small" onClick={() => openCustomer(r.customer_id)}>
                          Record return
                        </Button>
                      ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'history',
            label: 'History',
            children: (
              <Table
                rowKey="empties_txn_id"
                dataSource={txns}
                columns={[
                  { title: 'When', dataIndex: 'created_at', render: dateTime },
                  { title: 'Customer / supplier', render: (_, r: any) => r.customer_name ?? `${r.supplier_name} (supplier)` },
                  { title: 'Container', dataIndex: 'container_name' },
                  { title: 'Direction', dataIndex: 'direction', render: (d: string) => <Tag color={d === 'ISSUED' ? 'blue' : 'green'}>{d}</Tag> },
                  { title: 'Qty', dataIndex: 'quantity', align: 'right' },
                  { title: 'Deposit', dataIndex: 'deposit_value', align: 'right', render: cedi },
                  { title: 'Refund', dataIndex: 'refund_method', render: (m: string | null) => (m === 'CREDIT' ? 'Credited to account' : m === 'CASH' ? 'Cash' : '—') },
                  { title: 'Order', dataIndex: 'order_no', className: 'nowrap', render: (n: string | null) => n ?? '—' },
                  { title: 'By', dataIndex: 'recorded_by_name' },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        open={!!mode}
        title={mode === 'customer' ? 'Customer returns empties' : 'Return empties to supplier'}
        okText="Record"
        confirmLoading={saving}
        onOk={save}
        onCancel={() => setMode(null)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          {mode === 'customer' ? (
            <>
              <Form.Item name="customer_id" label="Customer" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={customers.map((c) => ({ value: c.customer_id, label: c.customer_name }))} />
              </Form.Item>
              {customerId && !held.length && <Typography.Text type="secondary">This customer holds no containers.</Typography.Text>}
              {held.map((h) => (
                <Form.Item
                  key={h.container_type_id}
                  name={['qty', String(h.container_type_id)]}
                  label={`${h.container_name} (holds ${h.containers_held}, ${cedi(h.deposit_amount)} each)`}
                >
                  <InputNumber min={0} max={h.containers_held} style={{ width: 160 }} />
                </Form.Item>
              ))}
              <Form.Item name="refund_method" label="Deposit refund">
                <Radio.Group
                  options={[
                    { value: 'CREDIT', label: 'Credit to account' },
                    { value: 'CASH', label: 'Pay in cash' },
                  ]}
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="supplier_id" label="Supplier" rules={[{ required: true }]}>
                <Select options={suppliers.map((s) => ({ value: s.supplier_id, label: s.supplier_name }))} />
              </Form.Item>
              {containers.map((c) => (
                <Form.Item key={c.container_type_id} name={['qty', String(c.container_type_id)]} label={c.container_name}>
                  <InputNumber min={0} style={{ width: 160 }} />
                </Form.Item>
              ))}
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
