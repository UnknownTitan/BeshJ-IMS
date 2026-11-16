import { Button, Card, Empty, Modal, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import { cedi, qtyWithPacks } from '../../format';
import { PoDraft } from './PurchaseOrderForm';

/** FR4: products at or below their reorder level, grouped by supplier, ready to turn into draft orders. */
export default function ReorderSuggestions({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (d: PoDraft) => void }) {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (open) get('/purchase-orders/suggestions').then(setRows);
  }, [open]);

  const bySupplier = rows.reduce<Record<string, any[]>>((acc, r) => {
    (acc[r.supplier_name] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={900} title="Reorder suggestions">
      <Typography.Paragraph type="secondary">
        Products at or below their reorder level. The suggestion tops stock up to twice the reorder level, minus anything already on order,
        rounded up to whole crates.
      </Typography.Paragraph>
      {rows.length === 0 && <Empty description="Nothing needs reordering" />}
      {Object.entries(bySupplier).map(([supplier, items]) => {
        const toOrder = items.filter((i) => i.suggested_qty > 0);
        return (
          <Card
            key={supplier}
            size="small"
            title={supplier}
            style={{ marginBottom: 12 }}
            extra={
              <Button
                type="primary"
                size="small"
                disabled={!toOrder.length}
                onClick={() =>
                  onCreate({
                    supplier_id: items[0].supplier_id,
                    lines: toOrder.map((i) => ({ product_id: i.product_id, quantity: i.suggested_qty, unit_cost: i.cost_price })),
                  })
                }
              >
                Create draft order
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="product_id"
              pagination={false}
              dataSource={items}
              columns={[
                { title: 'Product', dataIndex: 'product_name' },
                { title: 'In warehouse', dataIndex: 'warehouse_qty', align: 'right' },
                { title: 'Reorder level', dataIndex: 'reorder_level', align: 'right' },
                { title: 'Already on order', dataIndex: 'on_order', align: 'right' },
                {
                  title: 'Suggested',
                  align: 'right',
                  render: (_, r) => (r.suggested_qty ? qtyWithPacks(r.suggested_qty, r.base_unit, r.pack_qty) : 'Covered by open orders'),
                },
                { title: 'Est. cost', align: 'right', render: (_, r) => cedi(r.suggested_qty * r.cost_price) },
              ]}
            />
          </Card>
        );
      })}
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Close</Button>
      </Space>
    </Modal>
  );
}
