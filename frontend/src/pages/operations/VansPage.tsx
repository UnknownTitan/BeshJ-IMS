import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CarOutlined, CheckSquareOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, date, dateTime, qtyWithPacks } from '../../format';

/** UC6 - load vans in the morning, reconcile them in the evening. */
export default function VansPage() {
  const { can } = useAuth();
  const [vans, setVans] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loadVan, setLoadVan] = useState<any | null>(null);
  const [trip, setTrip] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadForm] = Form.useForm();
  const [recForm] = Form.useForm();
  const lines: any[] = Form.useWatch('lines', loadForm) ?? [];
  const counts = Form.useWatch('counts', recForm) ?? {};
  const cashDeclared = Form.useWatch('cash_declared', recForm);
  const canOperate = can('STORE_KEEPER', 'WAREHOUSE_MANAGER');

  const load = () => Promise.all([get('/vans'), get('/van-trips')]).then(([v, t]) => (setVans(v), setTrips(t)));
  useEffect(() => {
    load();
    Promise.all([get('/products'), get('/staff')]).then(([p, s]) => {
      setProducts(p);
      setStaff(s.filter((x: any) => x.role === 'DRIVER'));
    });
  }, []);
  const productById = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);

  const openTrip = (id: number) =>
    get(`/van-trips/${id}`).then((t) => {
      setTrip(t);
      recForm.resetFields();
      recForm.setFieldsValue({
        counts: Object.fromEntries(t.on_van.map((p: any) => [p.product_id, { returned: p.qty, damaged: 0 }])),
        cash_declared: t.cash_collected,
      });
    });

  const saveLoad = async () => {
    const v = await loadForm.validateFields();
    setSaving(true);
    try {
      const t = await post('/van-trips', {
        van_id: loadVan.van_id,
        driver_id: v.driver_id,
        notes: v.notes || undefined,
        lines: v.lines.map((l: any) => ({ product_id: l.product_id, quantity: l.quantity })),
      });
      message.success(`${t.trip_no}: ${loadVan.location_name} loaded`);
      setLoadVan(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reconcile = async () => {
    const v = await recForm.validateFields();
    setSaving(true);
    try {
      const t = await post(`/van-trips/${trip.trip_id}/reconcile`, {
        cash_declared: v.cash_declared,
        notes: v.notes || undefined,
        lines: trip.on_van.map((p: any) => ({
          product_id: p.product_id,
          qty_returned: v.counts[p.product_id]?.returned ?? 0,
          qty_damaged: v.counts[p.product_id]?.damaged ?? 0,
        })),
      });
      message.success(`${t.trip_no} reconciled`);
      setTrip(t);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const shortOf = (p: any) => p.qty - (counts[p.product_id]?.returned ?? 0) - (counts[p.product_id]?.damaged ?? 0);
  const shortValue = trip?.on_van?.reduce((s: number, p: any) => s + Math.max(shortOf(p), 0) * (productById.get(p.product_id)?.cost_price ?? 0), 0) ?? 0;

  return (
    <>
      <Typography.Title level={4}>Vans</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {vans.map((v) => (
          <Col xs={24} md={8} key={v.van_id}>
            <Card
              title={
                <Space>
                  <CarOutlined />
                  {v.location_name}
                </Space>
              }
              extra={v.open_trip_id ? <Badge status="processing" text="Out on trip" /> : <Badge status="default" text="At depot" />}
            >
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Registration">{v.vehicle_reg}</Descriptions.Item>
                <Descriptions.Item label="Driver">{v.driver_name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="On board">{v.units_on_board} units</Descriptions.Item>
              </Descriptions>
              <Space>
                {v.open_trip_id ? (
                  <Button type="primary" icon={<CheckSquareOutlined />} onClick={() => openTrip(v.open_trip_id)}>
                    {canOperate ? 'Reconcile' : 'View trip'} {v.open_trip_no}
                  </Button>
                ) : (
                  canOperate && (
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => {
                        loadForm.resetFields();
                        loadForm.setFieldsValue({ driver_id: v.driver_id ?? undefined, lines: [{}] });
                        setLoadVan(v);
                      }}
                    >
                      Load van
                    </Button>
                  )
                )}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Trips">
        <Table
          rowKey="trip_id"
          dataSource={trips}
          onRow={(r) => ({ onClick: () => openTrip(r.trip_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Trip', dataIndex: 'trip_no' },
            { title: 'Date', dataIndex: 'trip_date', render: date },
            { title: 'Van', dataIndex: 'van_name' },
            { title: 'Driver', dataIndex: 'driver_name' },
            { title: 'Loaded', dataIndex: 'units_loaded', align: 'right' },
            { title: 'Short', dataIndex: 'units_short', align: 'right', render: (s: number | null) => (s ? <Tag color="red">{s}</Tag> : s ?? '—') },
            {
              title: 'Cash',
              render: (_, r: any) =>
                r.status === 'RECONCILED' ? (
                  Number(r.cash_declared) < Number(r.cash_expected) ? (
                    <Tag color="red">{cedi(r.cash_declared - r.cash_expected)}</Tag>
                  ) : (
                    <Tag color="green">OK</Tag>
                  )
                ) : (
                  '—'
                ),
            },
            { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'LOADED' ? 'blue' : 'green'}>{s === 'LOADED' ? 'Out' : 'Reconciled'}</Tag> },
          ]}
        />
      </Card>

      {/* -------------------------------------------------------- load van */}
      <Drawer
        width={760}
        open={!!loadVan}
        onClose={() => setLoadVan(null)}
        title={`Load ${loadVan?.location_name ?? ''}`}
        extra={
          <Button type="primary" loading={saving} onClick={saveLoad}>
            Load van
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">Stock is taken from the Main Warehouse, earliest expiry first.</Typography.Paragraph>
        <Form form={loadForm} layout="vertical" requiredMark="optional">
          <Form.Item name="driver_id" label="Driver" rules={[{ required: true }]} style={{ maxWidth: 320 }}>
            <Select options={staff.map((s) => ({ value: s.user_id, label: s.full_name }))} />
          </Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => {
                  const p = productById.get(lines[f.name]?.product_id);
                  return (
                    <Space key={f.key} align="start" style={{ display: 'flex' }}>
                      <Form.Item name={[f.name, 'product_id']} rules={[{ required: true, message: 'Product' }]} style={{ width: 360 }}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Product"
                          options={products.map((x) => ({
                            value: x.product_id,
                            label: `${x.product_name} (${x.warehouse_qty} in warehouse)`,
                            disabled: lines.some((l, i) => i !== f.name && l?.product_id === x.product_id),
                          }))}
                          onChange={(id) => loadForm.setFieldValue(['lines', f.name, 'quantity'], productById.get(id)?.pack_qty ?? 1)}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'quantity']}
                        rules={[{ required: true, message: 'Qty' }, { type: 'number', max: p?.warehouse_qty, message: `Only ${p?.warehouse_qty}` }]}
                        extra={p && lines[f.name]?.quantity ? qtyWithPacks(lines[f.name].quantity, p.base_unit, p.pack_qty) : undefined}
                      >
                        <InputNumber min={1} step={p?.pack_qty ?? 1} style={{ width: 140 }} />
                      </Form.Item>
                      {fields.length > 1 && <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)} />}
                    </Space>
                  );
                })}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>
                  Add product
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Notes" style={{ marginTop: 16 }}>
            <Input maxLength={200} placeholder="e.g. Route: Kaneshie, Lapaz, Achimota" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ----------------------------------------------- trip / reconcile */}
      <Drawer
        width={900}
        open={!!trip}
        onClose={() => setTrip(null)}
        title={
          trip && (
            <Space>
              {trip.trip_no} · {trip.van_name}
              <Tag color={trip.status === 'LOADED' ? 'blue' : 'green'}>{trip.status === 'LOADED' ? 'Out' : 'Reconciled'}</Tag>
            </Space>
          )
        }
        extra={
          trip?.status === 'LOADED' &&
          canOperate && (
            <Button type="primary" loading={saving} onClick={reconcile}>
              Reconcile and close trip
            </Button>
          )
        }
      >
        {trip && (
          <>
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Driver">{trip.driver_name}</Descriptions.Item>
              <Descriptions.Item label="Loaded">
                {dateTime(trip.loaded_at)} by {trip.loaded_by_name}
              </Descriptions.Item>
              {trip.reconciled_at && (
                <Descriptions.Item label="Reconciled">
                  {dateTime(trip.reconciled_at)} by {trip.reconciled_by_name}
                </Descriptions.Item>
              )}
              {trip.notes && <Descriptions.Item label="Notes">{trip.notes}</Descriptions.Item>}
            </Descriptions>

            {trip.status === 'LOADED' ? (
              <Form form={recForm} layout="vertical">
                <Typography.Text strong>Count what came back</Typography.Text>
                <Table
                  size="small"
                  rowKey="product_id"
                  pagination={false}
                  style={{ marginTop: 8 }}
                  dataSource={trip.on_van}
                  columns={[
                    { title: 'Product', dataIndex: 'product_name' },
                    {
                      title: 'Loaded',
                      render: (_, p: any) => trip.lines.find((l: any) => l.product_id === p.product_id)?.qty_loaded ?? '—',
                      align: 'right',
                    },
                    { title: 'Sold', render: (_, p: any) => trip.sales.find((s: any) => s.product_id === p.product_id)?.quantity ?? 0, align: 'right' },
                    { title: 'Should be on van', dataIndex: 'qty', align: 'right' },
                    {
                      title: 'Good, back in stock',
                      render: (_, p: any) => (
                        <Form.Item name={['counts', p.product_id, 'returned']} style={{ margin: 0 }}>
                          <InputNumber min={0} max={p.qty} style={{ width: 100 }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Damaged',
                      render: (_, p: any) => (
                        <Form.Item name={['counts', p.product_id, 'damaged']} style={{ margin: 0 }}>
                          <InputNumber min={0} max={p.qty} style={{ width: 90 }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Missing',
                      align: 'right',
                      render: (_, p: any) => {
                        const s = shortOf(p);
                        return s < 0 ? <Tag color="red">Too many</Tag> : s > 0 ? <Tag color="red">{s}</Tag> : 0;
                      },
                    },
                  ]}
                />
                {shortValue > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={`Shortage worth ${cedi(shortValue)} at cost will be recorded against ${trip.driver_name}.`}
                  />
                )}
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={8}>
                    <Card size="small">
                      <Typography.Text type="secondary">Cash collected by the driver (system)</Typography.Text>
                      <div style={{ fontSize: 20 }}>{cedi(trip.cash_collected)}</div>
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="cash_declared" label="Cash handed in" rules={[{ required: true }]}>
                      <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    {cashDeclared != null && cashDeclared !== trip.cash_collected && (
                      <Alert type={cashDeclared < trip.cash_collected ? 'error' : 'info'} message={`Difference ${cedi(cashDeclared - trip.cash_collected)}`} />
                    )}
                  </Col>
                </Row>
                <Form.Item name="notes" label="Notes">
                  <Input maxLength={200} />
                </Form.Item>
              </Form>
            ) : (
              <>
                <Table
                  size="small"
                  rowKey="product_id"
                  pagination={false}
                  dataSource={trip.lines}
                  columns={[
                    { title: 'Product', dataIndex: 'product_name' },
                    { title: 'Loaded', dataIndex: 'qty_loaded', align: 'right' },
                    { title: 'Sold', dataIndex: 'qty_sold', align: 'right' },
                    { title: 'Expected back', dataIndex: 'qty_expected', align: 'right' },
                    { title: 'Returned', dataIndex: 'qty_returned', align: 'right' },
                    { title: 'Damaged', dataIndex: 'qty_damaged', align: 'right', render: (d: number) => (d ? <Tag color="orange">{d}</Tag> : 0) },
                    { title: 'Missing', dataIndex: 'qty_short', align: 'right', render: (d: number) => (d ? <Tag color="red">{d}</Tag> : 0) },
                  ]}
                />
                <Descriptions size="small" column={3} style={{ marginTop: 16 }}>
                  <Descriptions.Item label="Cash expected">{cedi(trip.cash_expected)}</Descriptions.Item>
                  <Descriptions.Item label="Cash handed in">{cedi(trip.cash_declared)}</Descriptions.Item>
                  <Descriptions.Item label="Difference">{cedi(trip.cash_declared - trip.cash_expected)}</Descriptions.Item>
                </Descriptions>
              </>
            )}

            {trip.sales.length > 0 && (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
                Sold from the van on invoices: {Array.from(new Set(trip.sales.flatMap((s: any) => s.invoices.split(', ')))).join(', ')}
              </Typography.Paragraph>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
