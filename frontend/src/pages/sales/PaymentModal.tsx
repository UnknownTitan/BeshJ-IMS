import { DatePicker, Form, Input, InputNumber, Modal, Select, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { post } from '../../api/client';
import { PAYMENT_METHODS, cedi } from '../../format';

export interface PaymentTarget {
  customer_id: number;
  customer_name: string;
  invoice_id: number;
  invoice_no: string;
  outstanding: number;
}

/** Record money received against an invoice (FR10). */
export default function PaymentModal({ target, onClose, onPaid }: { target: PaymentTarget | null; onClose: () => void; onPaid: (p: any) => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const method = Form.useWatch('payment_method', form);

  useEffect(() => {
    if (!target) return;
    form.resetFields();
    form.setFieldsValue({ amount: target.outstanding, payment_method: 'CASH', payment_date: dayjs() });
  }, [target]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const p = await post('/payments', {
        customer_id: target!.customer_id,
        invoice_id: target!.invoice_id,
        amount: v.amount,
        payment_method: v.payment_method,
        reference: v.reference || undefined,
        payment_date: v.payment_date.format('YYYY-MM-DD'),
      });
      message.success(`Payment of ${cedi(v.amount)} recorded`);
      onPaid(p);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!target} title="Record payment" okText="Record payment" confirmLoading={saving} onOk={save} onCancel={onClose} destroyOnClose>
      {target && (
        <Typography.Paragraph>
          {target.customer_name} · invoice <strong>{target.invoice_no}</strong> · {cedi(target.outstanding)} outstanding
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="amount" label="Amount (GH₵)" rules={[{ required: true }, { type: 'number', min: 0.01, max: target?.outstanding, message: `At most ${cedi(target?.outstanding)}` }]}>
          <InputNumber precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="payment_method" label="Method" rules={[{ required: true }]}>
          <Select options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item
          name="reference"
          label={method === 'MOBILE_MONEY' ? 'MoMo transaction ID' : method === 'CHEQUE' ? 'Cheque number' : method === 'BANK_TRANSFER' ? 'Bank reference' : 'Receipt number'}
          rules={[{ required: method !== 'CASH', message: 'Required for this payment method' }]}
        >
          <Input maxLength={30} />
        </Form.Item>
        <Form.Item name="payment_date" label="Date received" rules={[{ required: true }]}>
          <DatePicker format="DD MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
