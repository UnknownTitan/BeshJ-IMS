import { Button, Col, Divider, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, message } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../api/client';
import { RecordStamp } from '../history';

interface Props {
  /** null = closed, 'new' = create, otherwise the product being edited */
  product: any | 'new' | null;
  onClose: () => void;
  onSaved: (p: any) => void;
}

/** Create / edit a product with its unit conversions (UC1, FR1). */
export default function ProductForm({ product, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [lists, setLists] = useState<{ categories: any[]; suppliers: any[]; containers: any[] }>({
    categories: [],
    suppliers: [],
    containers: [],
  });
  const [saving, setSaving] = useState(false);
  const isNew = product === 'new';
  const packaging = Form.useWatch('packaging', form);

  useEffect(() => {
    Promise.all([get('/categories'), get('/suppliers'), get('/container-types')]).then(([categories, suppliers, containers]) =>
      setLists({ categories, suppliers, containers }),
    );
  }, []);

  useEffect(() => {
    if (!product) return;
    form.resetFields();
    if (product !== 'new') form.setFieldsValue(product);
    else form.setFieldsValue({ packaging: 'GLASS', base_unit: 'BOTTLE', reorder_level: 0, is_active: true, conversions: [] });
  }, [product]);

  // Only glass bottles and kegs carry a returnable container.
  useEffect(() => {
    if (packaging && !['GLASS', 'KEG'].includes(packaging)) form.setFieldValue('container_type_id', null);
  }, [packaging]);

  const save = async () => {
    const values = await form.validateFields();
    if (!values.barcode) values.barcode = null;
    setSaving(true);
    try {
      const saved = isNew ? await post('/products', values) : await patch(`/products/${product.product_id}`, values);
      message.success(isNew ? 'Product created' : 'Product updated');
      onSaved(saved);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width={640}
      open={!!product}
      onClose={onClose}
      title={isNew ? 'New product' : `Edit ${product?.product_name ?? ''}`}
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </Space>
      }
    >
      <RecordStamp entity="products" id={isNew ? null : product?.product_id} />
      <Form form={form} layout="vertical" requiredMark="optional">
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="brand" label="Brand" rules={[{ required: true }]}>
              <Input maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="product_name" label="Product name" rules={[{ required: true }]}>
              <Input maxLength={100} placeholder="e.g. Coca-Cola Original 300 ml glass" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
              <Input maxLength={20} placeholder="e.g. CC-300-GL" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="barcode"
              label="Barcode"
              rules={[{ pattern: /^[0-9]{8,13}$/, message: '8 to 13 digits' }]}
              tooltip="Click here and scan the product with a USB barcode scanner"
            >
              <Input maxLength={13} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="category_id" label="Category" rules={[{ required: true }]}>
              <Select options={lists.categories.map((c) => ({ value: c.category_id, label: c.category_name }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="supplier_id" label="Supplier" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={lists.suppliers.map((s) => ({ value: s.supplier_id, label: s.supplier_name }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          Pack
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="pack_size_ml" label="Size (ml)" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="packaging" label="Packaging" rules={[{ required: true }]}>
              <Select options={['GLASS', 'PET', 'CAN', 'KEG'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="base_unit" label="Counted in" rules={[{ required: true }]} tooltip="Stock is always held in this unit">
              <Select
                options={[
                  { value: 'BOTTLE', label: 'Bottles' },
                  { value: 'CAN', label: 'Cans' },
                  { value: 'KEG', label: 'Kegs' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={24}>
            <Form.Item name="container_type_id" label="Returnable container (empties)">
              <Select
                allowClear
                disabled={!['GLASS', 'KEG'].includes(packaging)}
                placeholder={['GLASS', 'KEG'].includes(packaging) ? 'None' : 'Only glass and kegs are returnable'}
                options={lists.containers.map((c) => ({
                  value: c.container_type_id,
                  label: `${c.container_name} (deposit GH₵ ${c.deposit_amount})`,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Unit conversions" tooltip="How many base units are in each bigger unit">
          <Form.List name="conversions">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name }) => (
                  <Space key={key} align="baseline" style={{ display: 'flex' }}>
                    1
                    <Form.Item name={[name, 'unit_name']} rules={[{ required: true, message: 'Unit' }]} style={{ marginBottom: 8 }}>
                      <Select
                        style={{ width: 120 }}
                        options={['CRATE', 'CARTON', 'PACK', 'KEG'].map((v) => ({ value: v, label: v.toLowerCase() }))}
                      />
                    </Form.Item>
                    =
                    <Form.Item name={[name, 'base_qty']} rules={[{ required: true, message: 'Qty' }]} style={{ marginBottom: 8 }}>
                      <InputNumber min={1} style={{ width: 100 }} />
                    </Form.Item>
                    {`${(form.getFieldValue('base_unit') ?? 'unit').toLowerCase()}s`}
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
                  Add conversion
                </Button>
              </>
            )}
          </Form.List>
        </Form.Item>

        <Divider orientation="left" plain>
          Prices and stock control
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="cost_price" label="Cost price (GH₵)" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="selling_price"
              label="Selling price (GH₵)"
              dependencies={['cost_price']}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, v) =>
                    v == null || v >= (getFieldValue('cost_price') ?? 0)
                      ? Promise.resolve()
                      : Promise.reject(new Error('Must not be below cost price')),
                }),
              ]}
            >
              <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="reorder_level" label="Reorder level" rules={[{ required: true }]} tooltip="Alert when warehouse stock falls to this">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          {!isNew && (
            <Col xs={24} sm={24}>
              <Form.Item name="is_active" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          )}
        </Row>
      </Form>
    </Drawer>
  );
}
