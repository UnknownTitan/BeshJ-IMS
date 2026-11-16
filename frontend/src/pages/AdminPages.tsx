import { Card, Result, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get } from '../api/client';
import { ROLE_LABELS, Role } from '../auth/AuthContext';
import { MenuEntry } from '../layout/menu';

/** UC10 - user list (Admin). Create/edit users arrives in Phase 1. */
export function UsersPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => void get('/users').then(setRows), []);
  return (
    <Card>
      <Typography.Title level={4}>Users</Typography.Title>
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
        ]}
      />
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
