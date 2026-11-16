import { Form, Input, Modal, message } from 'antd';
import { useState } from 'react';
import { post } from '../api/client';
import { PASSWORD_RULES } from '../pages/AdminPages';

/** Lets any logged-in user change their own password. */
export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const { current_password, new_password } = await form.validateFields();
    setSaving(true);
    try {
      await post('/auth/change-password', { current_password, new_password });
      message.success('Password changed');
      form.resetFields();
      onClose();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Change password" okText="Change" confirmLoading={saving} onOk={save} onCancel={onClose} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="current_password" label="Current password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="new_password" label="New password" rules={PASSWORD_RULES}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Repeat new password"
          dependencies={['new_password']}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || v === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
