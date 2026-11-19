import { Button, DatePicker, Drawer, Form, InputNumber, Select, Space, Typography, message } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { get, patch, post } from '../../api/client';
import { cedi, qtyWithPacks } from '../../format';

export interface PoDraft {
  po_id?: number;
  supplier_id?: number;
  expected_date?: string | null;
  lines: { product_id?: number; quantity?: number; unit_cost?: number }[];
}

interface Props {
  /** null = closed. A draft without po_id creates a new order. */
  draft: PoDraft | null;
  onClose: () => void;
  onSaved: (po: any) => void;
}

/** Raise or edit a DRAFT purchase order (UC2). Quantities are in base units; crates are shown alongside. */
export default function PurchaseOrderForm({ draft, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const supplierId = Form.useWatch('supplier_id', form);
  const lines: any[] = Form.useWatch('lines', form) ?? [];
  const isNew = !draft?.po_id;

  useEffect(() => {
    Promise.all([get('/suppliers'), get('/products')]).then(([s, p]) => {
      setSuppliers(s);
      setProducts(p);
    });
  }, []);

  useEffect(() => {
    if (!draft) return;
    form.resetFields();
    form.setFieldsValue({
      supplier_id: draft.supplier_id,
      expected_date: draft.expected_date ? dayjs(draft.expected_date) : null,
      lines: draft.lines.length ? draft.lines : [{}],
    });
  }, [draft]);

  const productById = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const supplierProducts = products.filter((p) => p.supplier_id === supplierId);
  const total = lines.reduce((s, l) => s + (l?.quantity ?? 0) * (l?.unit_cost ?? 0), 0);

  const save = async () => {
    const v = await form.validateFields();
    const body = {
      ...(isNew ? { supplier_id: v.supplier_id } : {}),
      expected_date: v.expected_date ? v.expected_date.format('YYYY-MM-DD') : null,
      lines: v.lines.map((l: any) => ({ product_id: l.product_id, quantity: l.quantity, unit_cost: l.unit_cost })),
    };
    setSaving(true);
    try {
      const po = isNew ? await post('/purchase-orders', body) : await patch(`/purchase-orders/${draft!.po_id}`, body);
      message.success(isNew ? `Draft ${po.po_no} created` : `${po.po_no} updated`);
      onSaved(po);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width={860}
      open={!!draft}
      onClose={onClose}
      title={isNew ? 'New purchase order' : 'Edit purchase order'}
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={save}>
            Save draft
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Space size="large" align="start">
          <Form.Item name="supplier_id" label="Supplier" rules={[{ required: true }]} style={{ width: 380 }}>
            <Select
              disabled={!isNew}
              showSearch
              optionFilterProp="label"
              options={suppliers.map((s) => ({ value: s.supplier_id, label: s.supplier_name }))}
              onChange={() => form.setFieldValue('lines', [{}])}
            />
          </Form.Item>
          <Form.Item name="expected_date" label="Expected delivery">
            <DatePicker format="DD MMM YYYY" disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
          </Form.Item>
        </Space>

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
                    width: 300,
                    render: (_, f) => (
                      <Form.Item name={[f.name, 'product_id']} rules={[{ required: true, message: 'Choose a product' }]} style={{ margin: 0 }}>
                        <Select
                          placeholder={supplierId ? 'Choose a product' : 'Choose the supplier first'}
                          disabled={!supplierId}
                          showSearch
                          optionFilterProp="label"
                          options={supplierProducts.map((p) => ({
                            value: p.product_id,
                            label: p.product_name,
                            disabled: lines.some((l, i) => i !== f.name && l?.product_id === p.product_id),
                          }))}
                          onChange={(id) => {
                            const p = productById.get(id);
                            form.setFieldValue(['lines', f.name, 'unit_cost'], p?.cost_price);
                            if (!form.getFieldValue(['lines', f.name, 'quantity'])) {
                              form.setFieldValue(['lines', f.name, 'quantity'], p?.pack_qty ?? 1);
                            }
                          }}
                        />
                      </Form.Item>
                    ),
                  },
                  {
                    title: 'Quantity',
                    width: 220,
                    render: (_, f) => {
                      const p = productById.get(lines[f.name]?.product_id);
                      return (
                        <>
                          <Form.Item name={[f.name, 'quantity']} rules={[{ required: true, message: 'Quantity' }]} style={{ margin: 0 }}>
                            <InputNumber min={1} step={p?.pack_qty ?? 1} style={{ width: '100%' }} />
                          </Form.Item>
                          {p && lines[f.name]?.quantity > 0 && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {qtyWithPacks(lines[f.name].quantity, p.base_unit, p.pack_qty)}
                            </Typography.Text>
                          )}
                        </>
                      );
                    },
                  },
                  {
                    title: 'Unit cost (GH₵)',
                    width: 140,
                    render: (_, f) => (
                      <Form.Item name={[f.name, 'unit_cost']} rules={[{ required: true, message: 'Cost' }]} style={{ margin: 0 }}>
                        <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  {
                    title: 'Line total',
                    align: 'right',
                    render: (_, f) => cedi((lines[f.name]?.quantity ?? 0) * (lines[f.name]?.unit_cost ?? 0)),
                  },
                  {
                    width: 40,
                    render: (_, f) => fields.length > 1 && <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)} />,
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3} align="right">
                      <strong>Order total</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <strong>{cedi(total)}</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} />
                  </Table.Summary.Row>
                )}
              />
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ marginTop: 12 }} disabled={!supplierId}>
                Add product
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}
