import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC } from '../Logo';

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
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#001529', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src={LOGO_SRC} width={64} height={64} alt="BESH. J Limited logo" style={{ display: 'inline-block' }} />
          <Typography.Title level={3} style={{ margin: '12px 0 0' }}>
            BESH. J Limited
          </Typography.Title>
          <Typography.Text type="secondary">Inventory Management System</Typography.Text>
        </div>
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
      </Card>
    </div>
  );
}
