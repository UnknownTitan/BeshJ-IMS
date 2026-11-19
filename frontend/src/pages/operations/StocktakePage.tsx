import { Alert, Button, Card, Col, Drawer, Form, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Tag, Typography, message } from 'antd';
import Table from '../../components/ResponsiveTable';
import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, date, dateTime } from '../../format';
import { DocumentTimeline } from '../../history';

const STATUS: Record<string, string> = { COUNTING: 'blue', POSTED: 'green', CANCELLED: 'default' };

/** UC4 - count stock, see differences, post adjustments. */
export default function StocktakePage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [st, setSt] = useState<any | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [locationId, setLocationId] = useState<number>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [form] = Form.useForm();
  const counts = Form.useWatch('counts', form) ?? {};

  const load = () => get('/stocktakes').then(setRows);
  useEffect(() => {
    load();
    get('/locations').then(setLocations);
  }, []);

  const show = (s: any) => {
    setSt(s);
    form.resetFields();
    form.setFieldsValue({ counts: Object.fromEntries(s.lines.map((l: any) => [l.batch_id, l.counted_qty ?? undefined])) });
  };
  const open = (id: number) => get(`/stocktakes/${id}`).then(show);

  const start = async () => {
    setBusy('start');
    try {
      const s = await post('/stocktakes', { location_id: locationId });
      message.success(`${s.stocktake_no} started: ${s.lines.length} batches to count`);
      setStartOpen(false);
      load();
      show(s);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const saveCounts = async () => {
    const entered = Object.entries(form.getFieldValue('counts') ?? {})
      .filter(([, q]) => q !== undefined && q !== null)
      .map(([batch_id, counted_qty]) => ({ batch_id: Number(batch_id), counted_qty }));
    setBusy('save');
    try {
      const s = await patch(`/stocktakes/${st.stocktake_id}/counts`, { counts: entered });
      message.success('Counts saved');
      show(s);
      load();
      return s;
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: 'post' | 'cancel') => {
    if (action === 'post' && !(await saveCounts())) return;
    setBusy(action);
    try {
      const s = await post(`/stocktakes/${st.stocktake_id}/${action}`, {});
      message.success(`${s.stocktake_no} ${action === 'post' ? 'posted: stock adjusted' : 'cancelled'}`);
      show(s);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const counting = st?.status === 'COUNTING';
  const canCount = can('STORE_KEEPER', 'WAREHOUSE_MANAGER');
  const liveVariance = (l: any) => (counting ? (counts[l.batch_id] ?? null) : l.counted_qty) === null ? null : (counting ? counts[l.batch_id] : l.counted_qty) - l.system_qty;

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Stocktake
        </Typography.Title>
        {canCount && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setStartOpen(true)}>
            Start a count
          </Button>
        )}
      </Space>
      <Table
        rowKey="stocktake_id"
        dataSource={rows}
        onRow={(r) => ({ onClick: () => open(r.stocktake_id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Count', dataIndex: 'stocktake_no', className: 'nowrap' },
          { title: 'Location', dataIndex: 'location_name' },
          { title: 'Started', render: (_, r: any) => `${dateTime(r.started_at)} · ${r.started_by_name}` },
          { title: 'Counted', render: (_, r: any) => `${r.counted} / ${r.batches}` },
          { title: 'Differences', dataIndex: 'differences', align: 'right', render: (d: number) => (d ? <Tag color="orange">{d}</Tag> : 0) },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={STATUS[s]}>{s}</Tag> },
          { title: 'Posted by', dataIndex: 'posted_by_name', render: (n: string | null) => n ?? '—' },
        ]}
      />

      <Modal open={startOpen} title="Start a stock count" okText="Start" confirmLoading={busy === 'start'} onOk={start} onCancel={() => setStartOpen(false)}>
        <Typography.Paragraph>
          The system records what it thinks is at the location now. Then count each batch and enter what is really there.
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          value={locationId}
          onChange={setLocationId}
          options={locations.map((l) => ({ value: l.location_id, label: l.location_name }))}
        />
      </Modal>

      <Drawer
        width={980}
        open={!!st}
        onClose={() => setSt(null)}
        title={
          st && (
            <Space>
              {st.stocktake_no} · {st.location_name}
              <Tag color={STATUS[st.status]}>{st.status}</Tag>
            </Space>
          )
        }
        extra={
          counting &&
          canCount && (
            <Space>
              {can('WAREHOUSE_MANAGER') && (
                <Popconfirm title="Cancel this count?" onConfirm={() => act('cancel')}>
                  <Button danger loading={busy === 'cancel'}>
                    Cancel count
                  </Button>
                </Popconfirm>
              )}
              <Button icon={<SaveOutlined />} loading={busy === 'save'} onClick={saveCounts}>
                Save counts
              </Button>
              {can('WAREHOUSE_MANAGER') && (
                <Popconfirm
                  title="Post this stocktake?"
                  description="Every difference becomes a stock adjustment. This cannot be undone."
                  onConfirm={() => act('post')}
                >
                  <Button type="primary" loading={busy === 'post'}>
                    Post adjustments
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      >
        {st && (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={24} sm={6}>
                <Statistic title="Batches counted" value={`${st.summary.counted} / ${st.summary.batches}`} />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic title="Differences" value={st.summary.differences} />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic title="Units short / over" value={`${st.summary.units_short} / ${st.summary.units_over}`} />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="Net value at cost"
                  value={cedi(st.summary.net_value)}
                  valueStyle={{ color: st.summary.net_value < 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>
            {counting && !can('WAREHOUSE_MANAGER') && (
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Save your counts. A Warehouse Manager reviews the differences and posts them." />
            )}
            <Form form={form}>
              <Table
                size="small"
                rowKey="batch_id"
                pagination={false}
                dataSource={st.lines}
                columns={[
                  { title: 'Product', dataIndex: 'product_name' },
                  { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap' },
                  { title: 'Expiry', dataIndex: 'expiry_date', render: date },
                  { title: 'System', dataIndex: 'system_qty', align: 'right' },
                  {
                    title: 'Counted',
                    render: (_, l: any) =>
                      counting && canCount ? (
                        <Form.Item name={['counts', String(l.batch_id)]} style={{ margin: 0 }}>
                          <InputNumber min={0} style={{ width: 110 }} />
                        </Form.Item>
                      ) : (
                        l.counted_qty ?? '—'
                      ),
                  },
                  {
                    title: 'Difference',
                    align: 'right',
                    render: (_, l: any) => {
                      const v = liveVariance(l);
                      return v === null || v === undefined ? '—' : v === 0 ? <Tag color="green">0</Tag> : <Tag color={v < 0 ? 'red' : 'blue'}>{v > 0 ? `+${v}` : v}</Tag>;
                    },
                  },
                  { title: 'Counted by', dataIndex: 'counted_by_name', render: (n: string | null) => n ?? '—' },
                ]}
              />
            </Form>
          </>
        )}
        {st && (
          <>
            <Typography.Title level={5} style={{ marginTop: 24 }}>
              History
            </Typography.Title>
            <DocumentTimeline doc="stocktakes" id={st.stocktake_id} refreshKey={st.status} />
          </>
        )}
      </Drawer>
    </Card>
  );
}
