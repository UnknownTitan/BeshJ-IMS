import { Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, List, Result, Row, Space, Tag, Typography, message } from 'antd';
import Table from '../../components/ResponsiveTable';
import { InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '../../api/client';
import { PO_STATUS_COLORS, date } from '../../format';

/**
 * UC5 - receive a delivery against an approved purchase order.
 * Store Keeper counts what arrived, records batch numbers and expiry dates,
 * and notes anything damaged. Good units go straight into stock.
 */
export default function ReceivingPage() {
  const [params, setParams] = useSearchParams();
  const [waiting, setWaiting] = useState<any[]>([]);
  const [po, setPo] = useState<any | null>(null);
  const [done, setDone] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const values = Form.useWatch('lines', form) ?? [];

  const loadWaiting = () => get('/purchase-orders?status=APPROVED,SENT,PARTIAL').then(setWaiting);

  useEffect(() => {
    loadWaiting();
  }, []);

  useEffect(() => {
    const id = params.get('po');
    if (!id) return setPo(null);
    setDone(null);
    get(`/purchase-orders/${id}`).then((p) => {
      setPo(p);
      form.resetFields();
      form.setFieldsValue({
        lines: p.lines.map((l: any) => ({
          line_no: l.line_no,
          qty_received: l.qty_outstanding,
          qty_damaged: 0,
        })),
      });
    });
  }, [params]);

  const submit = async () => {
    const v = await form.validateFields();
    const lines = v.lines
      .filter((l: any) => (l.qty_received ?? 0) + (l.qty_damaged ?? 0) > 0)
      .map((l: any) => ({
        line_no: l.line_no,
        qty_received: l.qty_received ?? 0,
        qty_damaged: l.qty_damaged ?? 0,
        damage_note: l.damage_note || undefined,
        batch_no: l.qty_received > 0 ? l.batch_no : undefined,
        expiry_date: l.qty_received > 0 ? l.expiry_date.format('YYYY-MM-DD') : undefined,
      }));
    if (!lines.length) return message.warning('Enter what arrived for at least one product');

    setSaving(true);
    try {
      const res = await post(`/purchase-orders/${po.po_id}/receive`, {
        delivery_note_no: v.delivery_note_no,
        notes: v.notes || undefined,
        lines,
      });
      setDone(res);
      loadWaiting();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ done screen
  if (done) {
    return (
      <Card>
        <Result
          status="success"
          title={`Delivery recorded: ${done.grn.grn_no}`}
          subTitle={`${done.po_no} is now ${done.status}. The good units are in stock at ${done.grn.location_name}.`}
          extra={[
            <Button key="another" type="primary" onClick={() => setParams({})}>
              Receive another delivery
            </Button>,
          ]}
        />
        <Table
          size="small"
          rowKey="line_no"
          pagination={false}
          dataSource={done.grn.lines}
          columns={[
            { title: 'Product', dataIndex: 'product_name' },
            { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap', render: (b: string | null) => b ?? '—' },
            { title: 'Expiry', dataIndex: 'expiry_date', render: date },
            { title: 'Into stock', dataIndex: 'qty_received', align: 'right' },
            { title: 'Damaged', dataIndex: 'qty_damaged', align: 'right' },
          ]}
        />
      </Card>
    );
  }

  // ------------------------------------------------------- choose an order
  if (!po) {
    return (
      <Card title="Receive stock">
        <Typography.Paragraph type="secondary">Choose the purchase order the delivery is for.</Typography.Paragraph>
        {waiting.length === 0 ? (
          <Empty description="No approved orders are waiting for delivery" />
        ) : (
          <List
            dataSource={waiting}
            renderItem={(o: any) => (
              <List.Item
                actions={[
                  <Button key="r" type="primary" icon={<InboxOutlined />} onClick={() => setParams({ po: String(o.po_id) })}>
                    Receive
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {o.po_no} <Tag color={PO_STATUS_COLORS[o.status]}>{o.status}</Tag>
                    </Space>
                  }
                  description={`${o.supplier_name} · expected ${date(o.expected_date)} · ${o.qty_outstanding.toLocaleString()} units outstanding`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    );
  }

  // ------------------------------------------------------- receiving form
  const open = po.lines.filter((l: any) => l.qty_outstanding > 0);
  return (
    <Card
      title={
        <Space>
          Receive stock · {po.po_no} <Tag color={PO_STATUS_COLORS[po.status]}>{po.status}</Tag>
        </Space>
      }
      extra={<Button onClick={() => setParams({})}>Back</Button>}
    >
      {!['APPROVED', 'SENT', 'PARTIAL'].includes(po.status) ? (
        <Alert type="warning" showIcon message={`This order is ${po.status} and cannot receive goods.`} />
      ) : (
        <Form form={form} layout="vertical" requiredMark="optional">
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Supplier">{po.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="Expected">{date(po.expected_date)}</Descriptions.Item>
            <Descriptions.Item label="Into">Main Warehouse - Accra</Descriptions.Item>
          </Descriptions>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="delivery_note_no" label="Supplier's delivery note no." rules={[{ required: true }]}>
                <Input maxLength={30} placeholder="e.g. DN-CCBG-78120" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={16}>
              <Form.Item name="notes" label="Notes">
                <Input maxLength={200} placeholder="e.g. Driver arrived late; seal intact" />
              </Form.Item>
            </Col>
          </Row>

          <Table
            size="small"
            pagination={false}
            rowKey="line_no"
            dataSource={po.lines}
            columns={[
              {
                title: 'Product',
                render: (_, l: any) => (
                  <>
                    {l.product_name}
                    <div style={{ fontSize: 12, color: '#888' }}>
                      Outstanding: {l.qty_outstanding} {l.base_unit.toLowerCase()}s
                    </div>
                  </>
                ),
              },
              {
                title: 'Good units',
                width: 120,
                render: (_, l: any, i: number) => (
                  <Form.Item
                    name={['lines', i, 'qty_received']}
                    style={{ margin: 0 }}
                    rules={[{ type: 'number', max: l.qty_outstanding, message: `Max ${l.qty_outstanding}` }]}
                  >
                    <InputNumber min={0} disabled={l.qty_outstanding === 0} style={{ width: '100%' }} />
                  </Form.Item>
                ),
              },
              {
                title: 'Damaged',
                width: 100,
                render: (_, l: any, i: number) => (
                  <Form.Item name={['lines', i, 'qty_damaged']} style={{ margin: 0 }}>
                    <InputNumber min={0} disabled={l.qty_outstanding === 0} style={{ width: '100%' }} />
                  </Form.Item>
                ),
              },
              {
                title: 'Batch no.',
                width: 140,
                render: (_, _l: any, i: number) => (
                  <Form.Item
                    name={['lines', i, 'batch_no']}
                    style={{ margin: 0 }}
                    normalize={(v: string) => v?.toUpperCase()}
                    rules={[{ required: (values[i]?.qty_received ?? 0) > 0, message: 'Required' }]}
                  >
                    <Input maxLength={20} disabled={!(values[i]?.qty_received > 0)} />
                  </Form.Item>
                ),
              },
              {
                title: 'Expiry date',
                width: 150,
                render: (_, _l: any, i: number) => (
                  <Form.Item
                    name={['lines', i, 'expiry_date']}
                    style={{ margin: 0 }}
                    rules={[{ required: (values[i]?.qty_received ?? 0) > 0, message: 'Required' }]}
                  >
                    <DatePicker
                      format="DD MMM YYYY"
                      disabled={!(values[i]?.qty_received > 0)}
                      disabledDate={(d) => !d.isAfter(dayjs(), 'day')}
                    />
                  </Form.Item>
                ),
              },
              {
                title: 'Damage note',
                render: (_, _l: any, i: number) => (
                  <Form.Item
                    name={['lines', i, 'damage_note']}
                    style={{ margin: 0 }}
                    rules={[{ required: (values[i]?.qty_damaged ?? 0) > 0, message: 'What was wrong?' }]}
                  >
                    <Input maxLength={200} disabled={!(values[i]?.qty_damaged > 0)} placeholder="e.g. 1 crate broken" />
                  </Form.Item>
                ),
              },
            ]}
          />
          {/* keep line numbers in the form values */}
          {po.lines.map((l: any, i: number) => (
            <Form.Item key={l.line_no} name={['lines', i, 'line_no']} hidden>
              <Input />
            </Form.Item>
          ))}

          <Space style={{ marginTop: 16, width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary">
              {open.length} product{open.length === 1 ? '' : 's'} outstanding. Damaged units are not put into stock; the supplier still owes them.
            </Typography.Text>
            <Button type="primary" size="large" icon={<InboxOutlined />} loading={saving} onClick={submit}>
              Record delivery
            </Button>
          </Space>
        </Form>
      )}
    </Card>
  );
}
