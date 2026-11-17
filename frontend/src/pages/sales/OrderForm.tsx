import { Alert, Button, Descriptions, Drawer, Form, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { get, patch, post } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { cedi, qtyWithPacks } from '../../format';

export interface OrderDraft {
  order_id?: number;
  customer_id?: number;
  lines: { product_id?: number; quantity?: number; unit_price?: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Take a customer order (UC9). Totals update as you type, including 20% tax and crate deposits. */
export default function OrderForm({ draft, onClose, onSaved }: { draft: OrderDraft | null; onClose: () => void; onSaved: (o: any) => void }) {
  const [form] = Form.useForm();
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [taxRate, setTaxRate] = useState(20);
  const [saving, setSaving] = useState<null | 'save' | 'submit'>(null);
  const { can } = useAuth();
  const canPrice = can('WAREHOUSE_MANAGER', 'ACCOUNTANT');
  const customerId = Form.useWatch('customer_id', form);
  const lines: any[] = Form.useWatch('lines', form) ?? [];
  const isNew = !draft?.order_id;

  useEffect(() => {
    Promise.all([get('/customers'), get('/products'), get('/container-types'), get('/tax-rates')]).then(([c, p, ct, t]) => {
      setCustomers(c);
      setProducts(p);
      setContainers(ct);
      setTaxRate(t.reduce((s: number, r: any) => s + r.rate_percent, 0));
    });
  }, []);

  useEffect(() => {
    if (!draft) return;
    form.resetFields();
    form.setFieldsValue({ customer_id: draft.customer_id, lines: draft.lines.length ? draft.lines : [{}] });
  }, [draft]);

  const productById = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const containerById = useMemo(() => new Map(containers.map((c) => [c.container_type_id, c])), [containers]);
  const customer = customers.find((c) => c.customer_id === customerId);

  const deposit = (p: any, qty: number) => {
    const ct = p?.container_type_id && containerById.get(p.container_type_id);
    if (!ct || !qty) return 0;
    const n = ct.units_held ? Math.ceil(qty / ct.units_held) : qty;
    return n * ct.deposit_amount;
  };
  const subtotal = round2(lines.reduce((s, l) => s + (l?.quantity ?? 0) * (l?.unit_price ?? 0), 0));
  const tax = round2((subtotal * taxRate) / 100);
  const deposits = round2(lines.reduce((s, l) => s + deposit(productById.get(l?.product_id), l?.quantity ?? 0), 0));
  const total = round2(subtotal + tax + deposits);
  const creditAvailable = customer?.payment_terms === 'CREDIT' ? customer.credit_available : null;

  const save = async (andSubmit: boolean) => {
    const v = await form.validateFields();
    const body = {
      lines: v.lines.map((l: any) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        ...(canPrice ? { unit_price: l.unit_price } : {}),
      })),
    };
    setSaving(andSubmit ? 'submit' : 'save');
    try {
      let order = isNew ? await post('/orders', { customer_id: v.customer_id, ...body }) : await patch(`/orders/${draft!.order_id}`, body);
      if (andSubmit) {
        order = await post(`/orders/${order.order_id}/submit`, {});
        message.success(
          order.status === 'PENDING_CREDIT_APPROVAL'
            ? `${order.order_no} is over the credit limit and needs an Accountant's approval`
            : `${order.order_no} confirmed`,
        );
      } else {
        message.success(`Draft ${order.order_no} saved`);
      }
      onSaved(order);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Drawer
      width={900}
      open={!!draft}
      onClose={onClose}
      title={isNew ? 'New customer order' : 'Edit order'}
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={saving === 'save'} onClick={() => save(false)}>
            Save draft
          </Button>
          <Button type="primary" loading={saving === 'submit'} onClick={() => save(true)}>
            Save and submit
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="customer_id" label="Customer" rules={[{ required: true }]} style={{ maxWidth: 420 }}>
          <Select
            disabled={!isNew}
            showSearch
            optionFilterProp="label"
            options={customers.map((c) => ({ value: c.customer_id, label: c.customer_name }))}
          />
        </Form.Item>
        {customer && (
          <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Terms">
              <Tag color={customer.payment_terms === 'CREDIT' ? 'blue' : 'default'}>{customer.payment_terms}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Balance owed">{cedi(customer.balance)}</Descriptions.Item>
            {customer.payment_terms === 'CREDIT' && (
              <>
                <Descriptions.Item label="Credit limit">{cedi(customer.credit_limit)}</Descriptions.Item>
                <Descriptions.Item label="Available">{cedi(customer.credit_available)}</Descriptions.Item>
              </>
            )}
          </Descriptions>
        )}

        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              <Table
                size="small"
                pagination={false}
                dataSource={fields}
                rowKey="key"
                columns={[
                  {
                    title: 'Product',
                    width: 290,
                    render: (_, f) => (
                      <Form.Item name={[f.name, 'product_id']} rules={[{ required: true, message: 'Choose a product' }]} style={{ margin: 0 }}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Choose a product"
                          options={products.map((p) => ({
                            value: p.product_id,
                            label: `${p.product_name} (${p.warehouse_qty} in stock)`,
                            disabled: lines.some((l, i) => i !== f.name && l?.product_id === p.product_id),
                          }))}
                          onChange={(id) => {
                            const p = productById.get(id);
                            form.setFieldValue(['lines', f.name, 'unit_price'], p?.selling_price);
                            if (!form.getFieldValue(['lines', f.name, 'quantity'])) form.setFieldValue(['lines', f.name, 'quantity'], p?.pack_qty ?? 1);
                          }}
                        />
                      </Form.Item>
                    ),
                  },
                  {
                    title: 'Quantity',
                    width: 190,
                    render: (_, f) => {
                      const p = productById.get(lines[f.name]?.product_id);
                      const q = lines[f.name]?.quantity;
                      return (
                        <>
                          <Form.Item
                            name={[f.name, 'quantity']}
                            rules={[
                              { required: true, message: 'Quantity' },
                              { type: 'number', max: p?.warehouse_qty, message: `Only ${p?.warehouse_qty} in stock` },
                            ]}
                            style={{ margin: 0 }}
                          >
                            <InputNumber min={1} step={p?.pack_qty ?? 1} style={{ width: '100%' }} />
                          </Form.Item>
                          {p && q > 0 && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {qtyWithPacks(q, p.base_unit, p.pack_qty)}
                            </Typography.Text>
                          )}
                        </>
                      );
                    },
                  },
                  {
                    title: 'Unit price',
                    width: 120,
                    render: (_, f) => (
                      <Form.Item name={[f.name, 'unit_price']} style={{ margin: 0 }}>
                        <InputNumber min={0} step={0.1} precision={2} disabled={!canPrice} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  { title: 'Amount', align: 'right', render: (_, f) => cedi((lines[f.name]?.quantity ?? 0) * (lines[f.name]?.unit_price ?? 0)) },
                  {
                    title: 'Deposit',
                    align: 'right',
                    render: (_, f) => {
                      const d = deposit(productById.get(lines[f.name]?.product_id), lines[f.name]?.quantity ?? 0);
                      return d ? cedi(d) : '—';
                    },
                  },
                  { width: 40, render: (_, f) => fields.length > 1 && <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)} /> },
                ]}
              />
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ marginTop: 12 }}>
                Add product
              </Button>
            </>
          )}
        </Form.List>
      </Form>

      <Descriptions size="small" column={1} bordered style={{ marginTop: 24, maxWidth: 380, marginLeft: 'auto' }}>
        <Descriptions.Item label="Subtotal">{cedi(subtotal)}</Descriptions.Item>
        <Descriptions.Item label={`Tax ${taxRate}% (VAT, NHIL, GETFund)`}>{cedi(tax)}</Descriptions.Item>
        <Descriptions.Item label="Container deposit">{cedi(deposits)}</Descriptions.Item>
        <Descriptions.Item label={<strong>Total</strong>}>
          <strong>{cedi(total)}</strong>
        </Descriptions.Item>
      </Descriptions>
      {creditAvailable != null && total > creditAvailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="Over the customer's credit limit"
          description={`This order (${cedi(total)}) is more than the ${cedi(creditAvailable)} of credit available. You can still submit it; an Accountant must approve it before it is invoiced.`}
        />
      )}
      {!canPrice && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Prices are the list prices. Only a Warehouse Manager or Accountant can change them.
        </Typography.Paragraph>
      )}
    </Drawer>
  );
}
