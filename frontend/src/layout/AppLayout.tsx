import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext';
import { MENU } from './menu';

const { Sider, Header, Content } = Layout;

export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Show only the menu items this role may use (FR12).
  const items = MENU.filter((m) => m.roles.length === 0 || can(...m.roles)).map((m) => ({
    key: m.path,
    icon: m.icon,
    label: m.label,
  }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={230} theme="dark" breakpoint="lg" collapsedWidth={64}>
        <div style={{ color: '#fff', padding: '18px 20px', fontWeight: 700, fontSize: 16, letterSpacing: 0.3 }}>
          BESH. J IMS
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}
        >
          <Space size="middle">
            <Avatar icon={<UserOutlined />} />
            <Typography.Text strong>{user?.fullName}</Typography.Text>
            <Tag color="blue">{user && ROLE_LABELS[user.role]}</Tag>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              Log out
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
