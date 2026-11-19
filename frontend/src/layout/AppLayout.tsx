import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Space, Tag, Typography } from 'antd';
import { DownOutlined, KeyOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import ChangePasswordModal from './ChangePasswordModal';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext';
import { MENU } from './menu';

const { Sider, Header, Content } = Layout;

/**
 * Wide screens (laptops, 1200 px and up): a fixed sidebar.
 * Tablets (portrait and landscape): the whole width goes to the page; the menu
 * slides out from a ☰ button, and the account actions sit under the user's name.
 */
export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const wide = screens.xl ?? window.innerWidth >= 1200;
  const phone = !(screens.sm ?? window.innerWidth >= 576);

  // Show only the menu items this role may use (FR12).
  const items = MENU.filter((m) => m.roles.length === 0 || can(...m.roles)).map((m) => ({
    key: m.path,
    icon: m.icon,
    label: m.label,
  }));

  const logo = (
    <div style={{ color: '#fff', padding: '18px 20px', fontWeight: 700, fontSize: 16, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
      BESH. J IMS
    </div>
  );
  const nav = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[location.pathname]}
      items={items}
      onClick={({ key }) => {
        navigate(key);
        setMenuOpen(false);
      }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {wide && (
        <Sider width={230} theme="dark">
          {logo}
          {nav}
        </Sider>
      )}
      <Layout style={{ minWidth: 0 }}>
        <Header
          style={{
            background: '#fff',
            padding: wide ? '0 24px' : '0 12px 0 8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: wide ? undefined : 'sticky',
            top: 0,
            zIndex: 10,
            boxShadow: wide ? undefined : '0 1px 0 #eee',
          }}
        >
          {wide ? (
            <span />
          ) : (
            <Space size={4}>
              <Button type="text" size="large" icon={<MenuOutlined />} aria-label="Menu" onClick={() => setMenuOpen(true)} />
              <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
                BESH. J IMS
              </Typography.Text>
            </Space>
          )}

          {wide ? (
            <Space size="middle">
              <Avatar icon={<UserOutlined />} />
              <Typography.Text strong>{user?.fullName}</Typography.Text>
              <Tag color="blue">{user && ROLE_LABELS[user.role]}</Tag>
              <Button icon={<KeyOutlined />} onClick={() => setPwOpen(true)}>
                Change password
              </Button>
              <Button icon={<LogoutOutlined />} onClick={logout}>
                Log out
              </Button>
            </Space>
          ) : (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'who', label: `${user?.fullName} · ${user ? ROLE_LABELS[user.role] : ''}`, disabled: true },
                  { type: 'divider' },
                  { key: 'pw', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPwOpen(true) },
                  { key: 'out', icon: <LogoutOutlined />, label: 'Log out', onClick: logout },
                ],
              }}
            >
              <Button type="text" size="large" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} />
                {/* On a phone the name and role move into the menu */}
                {!phone && <span>{user?.fullName}</span>}
                {!phone && (
                  <Tag color="blue" style={{ margin: 0 }}>
                    {user && ROLE_LABELS[user.role]}
                  </Tag>
                )}
                <DownOutlined style={{ fontSize: 11 }} />
              </Button>
            </Dropdown>
          )}
        </Header>
        <Content style={{ padding: wide ? 24 : phone ? 8 : 16 }}>
          <Outlet />
        </Content>
        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </Layout>

      {!wide && (
        <Drawer
          placement="left"
          width={phone ? '82%' : 280}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          closable={false}
          styles={{ body: { padding: 0, background: '#001529' } }}
        >
          {logo}
          {nav}
        </Drawer>
      )}
    </Layout>
  );
}
