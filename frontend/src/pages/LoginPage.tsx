import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onFinish = async (v: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await login(v.username, v.password);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#001529' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          BESH. J Limited
        </Typography.Title>
        <Typography.Paragraph type="secondary">Inventory Management System</Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter your username' }]}>
            <Input prefix={<UserOutlined />} autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            Log in
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
          Demo users: kappiah (Admin), kmensah (Warehouse Manager), aowusu (Store Keeper), kasante (Sales Rep),
          edarko (Accountant), aadjei (Management). Password: Password123!
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
