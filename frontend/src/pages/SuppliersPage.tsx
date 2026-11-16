import { Button, Card, Col, Form, Input, Modal, Row, Space, Table, Typography, message } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/** Suppliers and manufacturers. The Warehouse Manager maintains them. */
export default function SuppliersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { can } = useAuth();
  const canEdit = can('WAREHOUSE_MANAGER');

  const load = () => get('/suppliers').then(setRows);
  useEffect(() => void load(), []);

  const open = (s: any | 'new') => {
    form.resetFields();
    if (s !== 'new') form.setFieldsValue(s);
    setEditing(s);
  };

  const save = async () => {
    const values = await form.validateFields();
    if (!values.email) values.email = null;
    setSaving(true);
    try {
      if (editing === 'new') await post('/suppliers', values);
      else await patch(`/suppliers/${editing.supplier_id}`, values);
      message.success('Supplier saved');
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
          Suppliers
        </Typography.Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            New supplier
          </Button>
        )}
      </Space>
      <Table
        rowKey="supplier_id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Supplier', dataIndex: 'supplier_name' },
          { title: 'Contact', dataIndex: 'contact_person' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'TIN', dataIndex: 'tin' },
          { title: 'Products', dataIndex: 'product_count', align: 'right' },
          ...(canEdit
            ? [{ title: '', key: 'edit', width: 60, render: (_: any, r: any) => <Button size="small" icon={<EditOutlined />} onClick={() => open(r)} /> }]
            : []),
        ]}
      />
      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New supplier' : 'Edit supplier'}
        okText="Save"
        confirmLoading={saving}
        onOk={save}
        onCancel={() => setEditing(null)}
        width={620}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item name="supplier_name" label="Supplier name" rules={[{ required: true }]}>
                <Input maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact_person" label="Contact person">
                <Input maxLength={80} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone" rules={[{ required: true }, { pattern: /^\+?[0-9]{9,14}$/, message: '9 to 14 digits' }]}>
                <Input maxLength={15} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tin" label="TIN (Ghana Revenue Authority)" rules={[{ required: true }]}>
                <Input maxLength={15} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="Address" rules={[{ required: true }]}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}
