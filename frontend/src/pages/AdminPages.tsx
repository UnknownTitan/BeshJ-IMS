import { Button, Card, Form, Input, Modal, Result, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../api/client';
import { ROLE_LABELS, Role, useAuth } from '../auth/AuthContext';

/** Same rule as the API: at least 8 characters with a letter and a number. */
export const PASSWORD_RULES = [
  { required: true, message: 'Enter a password' },
  { pattern: /^(?=.*[A-Za-z])(?=.*[0-9]).{8,72}$/, message: 'At least 8 characters, with a letter and a number' },
];
import { MenuEntry } from '../layout/menu';
import { lastChangedColumn, RecordStamp } from '../history';

/** UC10 - manage users and roles (Admin). */
export function UsersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [resetting, setResetting] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();
  const { user } = useAuth();

  const load = () => get('/users').then(setRows);
  useEffect(() => void load(), []);

  const open = (u: any | 'new') => {
    form.resetFields();
    form.setFieldsValue(u === 'new' ? { role: 'SALES_REP', is_active: true } : u);
    setEditing(u);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing === 'new') await post('/users', values);
      else {
        const { full_name, role, phone, is_active } = values;
        await patch(`/users/${editing.user_id}`, { full_name, role, phone, is_active });
      }
      message.success('User saved');
      setEditing(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    const { password } = await pwForm.validateFields();
    try {
      await post(`/users/${resetting.user_id}/reset-password`, { password });
      message.success(`Password reset for ${resetting.full_name}. Give them the new password.`);
      setResetting(null);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const isSelf = editing && editing !== 'new' && editing.user_id === user?.userId;

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Users
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
          New user
        </Button>
      </Space>
      <Table
        rowKey="user_id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Name', dataIndex: 'full_name' },
          { title: 'Username', dataIndex: 'username' },
          { title: 'Role', dataIndex: 'role', render: (r: Role) => <Tag color="blue">{ROLE_LABELS[r]}</Tag> },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Active', dataIndex: 'is_active', render: (a: boolean) => (a ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>) },
          { title: 'Last login', dataIndex: 'last_login', render: (d: string | null) => (d ? new Date(d).toLocaleString() : '—') },
          lastChangedColumn,
          {
            title: '',
            key: 'actions',
            width: 210,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => open(r)}>
                  Edit
                </Button>
                <Button size="small" icon={<KeyOutlined />} onClick={() => (pwForm.resetFields(), setResetting(r))}>
                  Reset password
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New user' : 'Edit user'}
        okText="Save"
        confirmLoading={saving}
        onOk={save}
        onCancel={() => setEditing(null)}
        destroyOnClose
      >
        <RecordStamp entity="users" id={editing && editing !== 'new' ? editing.user_id : null} />
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="username"
            label="Username"
            normalize={(v: string) => v?.toLowerCase()}
            rules={[{ required: true }, { pattern: /^[a-z0-9._]{3,30}$/, message: '3-30 lowercase letters, digits, dots or underscores' }]}
          >
            <Input disabled={editing !== 'new'} maxLength={30} />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select disabled={isSelf} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="phone" label="Phone" rules={[{ required: true }, { pattern: /^\+?[0-9]{9,14}$/, message: '9 to 14 digits' }]}>
            <Input maxLength={15} />
          </Form.Item>
          {editing === 'new' ? (
            <Form.Item name="password" label="Temporary password" rules={PASSWORD_RULES} extra="The user should change it after first login.">
              <Input.Password />
            </Form.Item>
          ) : (
            <Form.Item name="is_active" label="Active" valuePropName="checked" extra={isSelf ? 'You cannot deactivate yourself.' : 'Inactive users cannot log in.'}>
              <Switch disabled={isSelf} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal open={!!resetting} title={`Reset password: ${resetting?.full_name ?? ''}`} okText="Reset" onOk={resetPassword} onCancel={() => setResetting(null)} destroyOnClose>
        <Form form={pwForm} layout="vertical">
          <Form.Item name="password" label="New temporary password" rules={PASSWORD_RULES}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

/** FR12 - audit trail of who did what and when (Admin, Management). */
export function AuditLogPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => void get('/audit-log?limit=200').then(setRows), []);
  return (
    <Card>
      <Typography.Title level={4}>Audit trail</Typography.Title>
      <Table
        rowKey="audit_id"
        size="small"
        dataSource={rows}
        expandable={{
          rowExpandable: (r) => !!(r.old_data || r.new_data),
          expandedRowRender: (r) => (
            <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify({ before: r.old_data, after: r.new_data }, null, 2)}
            </pre>
          ),
        }}
        columns={[
          { title: 'When', dataIndex: 'changed_at', render: (d: string) => new Date(d).toLocaleString() },
          { title: 'Who', dataIndex: 'changed_by' },
          { title: 'Action', dataIndex: 'operation', render: (o: string) => <Tag>{o}</Tag> },
          { title: 'Table', dataIndex: 'table_name' },
          { title: 'Record', dataIndex: 'record_key' },
        ]}
      />
    </Card>
  );
}

/** Placeholder for screens scheduled in later phases of the roadmap. */
export function ComingSoon({ entry }: { entry: MenuEntry }) {
  return (
    <Card>
      <Result
        status="info"
        title={entry.label}
        subTitle={`${entry.useCase ?? ''} is scheduled for Phase ${entry.phase} of the build roadmap.`}
      />
    </Card>
  );
}
