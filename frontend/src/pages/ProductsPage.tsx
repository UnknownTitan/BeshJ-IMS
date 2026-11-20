import { Button, Card, Checkbox, Descriptions, Drawer, Input, Space, Tag, Typography, message } from 'antd';
import Table from '../components/ResponsiveTable';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { get } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import ProductForm from './ProductForm';
import { date, dateTime } from '../format';
import { lastChangedColumn, RecordStamp } from '../history';
import { ScanBar } from '../components/BarcodeScanner';

const MOVE_COLORS: Record<string, string> = {
  RECEIPT: 'green',
  SALE: 'blue',
  VAN_LOAD: 'geekblue',
  VAN_RETURN: 'cyan',
  TRANSFER: 'purple',
  BREAKAGE: 'red',
  ADJUSTMENT: 'orange',
};

/** UC1 - product catalogue. Everyone can view; the Warehouse Manager adds and edits. */
export default function ProductsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const { can } = useAuth();
  const canEdit = can('WAREHOUSE_MANAGER');

  const load = (q = search, inactive = showInactive) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('search', q);
    if (inactive) params.set('includeInactive', 'true');
    get(`/products?${params}`)
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(() => load('', false), []);

  const [movements, setMovements] = useState<any[]>([]);
  const canSeeLedger = can('WAREHOUSE_MANAGER', 'STORE_KEEPER', 'MANAGEMENT', 'ACCOUNTANT');

  /** A scanned barcode (or SKU) opens that product's details straight away. */
  const scanned = (code: string) =>
    get(`/products/barcode/${encodeURIComponent(code)}`)
      .then((p) => open(p.product_id))
      .catch(() => message.error(`No product has the barcode ${code}`));

  const open = (id: number) => {
    get(`/products/${id}`).then(setSelected);
    if (canSeeLedger) get(`/stock/movements?productId=${id}&limit=20`).then(setMovements);
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Products
        </Typography.Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            New product
          </Button>
        )}
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="Search by name, brand, SKU or barcode"
          allowClear
          enterButton
          style={{ width: 360, maxWidth: '100%' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(q) => load(q)}
        />
        <ScanBar onScan={scanned} placeholder="Scan a barcode" width={280} />
        <Checkbox
          checked={showInactive}
          onChange={(e) => {
            setShowInactive(e.target.checked);
            load(search, e.target.checked);
          }}
        >
          Show inactive
        </Checkbox>
      </Space>
      <Table
        rowKey="product_id"
        loading={loading}
        dataSource={rows}
        onRow={(r) => ({ onClick: () => open(r.product_id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'SKU', responsive: ['sm'], dataIndex: 'sku', className: 'nowrap' },
          { title: 'Brand', dataIndex: 'brand', responsive: ['xl'] },
          {
            title: 'Product',
            dataIndex: 'product_name',
            onCell: () => ({ style: { minWidth: 190 } }),
            render: (n: string, r) => (r.is_active ? n : <Typography.Text type="secondary">{n} <Tag>Inactive</Tag></Typography.Text>),
          },
          { title: 'Category', dataIndex: 'category_name', responsive: ['lg'] },
          { title: 'Pack', responsive: ['sm'], className: 'nowrap', render: (_, r) => `${r.pack_size_ml} ml ${r.packaging}` },
          { title: 'Selling price', dataIndex: 'selling_price', align: 'right', render: (v: number) => `GH₵\u00a0${v.toFixed(2)}` },
          {
            title: 'In warehouse',
            dataIndex: 'warehouse_qty',
            align: 'right',
            render: (q: number, r) => (q <= r.reorder_level ? <Tag color="red">{q}</Tag> : q),
          },
          lastChangedColumn,
        ]}
      />

      <Drawer
        width={560}
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.product_name}
        extra={
          canEdit && (
            <Button icon={<EditOutlined />} onClick={() => setEditing(selected)}>
              Edit
            </Button>
          )
        }
      >
        {selected && (
          <>
            <RecordStamp entity="products" id={selected.product_id} />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="SKU">{selected.sku}</Descriptions.Item>
              <Descriptions.Item label="Barcode">{selected.barcode ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Brand">{selected.brand}</Descriptions.Item>
              <Descriptions.Item label="Category">{selected.category_name}</Descriptions.Item>
              <Descriptions.Item label="Supplier">{selected.supplier_name}</Descriptions.Item>
              <Descriptions.Item label="Cost / selling price">
                GH₵ {selected.cost_price.toFixed(2)} / GH₵ {selected.selling_price.toFixed(2)}
              </Descriptions.Item>
              <Descriptions.Item label="Reorder level">
                {selected.reorder_level} {selected.base_unit.toLowerCase()}s
              </Descriptions.Item>
              <Descriptions.Item label="Returnable container">
                {selected.container_name ? `${selected.container_name} (deposit GH₵ ${selected.deposit_amount})` : 'None'}
              </Descriptions.Item>
              <Descriptions.Item label="Unit conversions">
                {selected.conversions.length
                  ? selected.conversions.map((c: any) => (
                      <div key={c.unit_name}>
                        1 {c.unit_name.toLowerCase()} = {c.base_qty} {selected.base_unit.toLowerCase()}s
                      </div>
                    ))
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 24 }}>
              Batches (earliest expiry first)
            </Typography.Title>
            <Table
              rowKey="batch_id"
              size="small"
              pagination={false}
              dataSource={selected.batches}
              columns={[
                { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap' },
                { title: 'Location', dataIndex: 'location_name' },
                { title: 'Expiry', dataIndex: 'expiry_date', render: date },
                { title: 'Qty', dataIndex: 'qty_on_hand', align: 'right' },
              ]}
            />
            {canSeeLedger && (
              <>
                <Typography.Title level={5} style={{ marginTop: 24 }}>
                  Recent stock movements
                </Typography.Title>
                <Table
                  rowKey="movement_id"
                  size="small"
                  pagination={false}
                  dataSource={movements}
                  locale={{ emptyText: 'No movements recorded' }}
                  columns={[
                    { title: 'When', dataIndex: 'movement_time', render: dateTime },
                    { title: 'Type', dataIndex: 'movement_type', render: (t: string) => <Tag color={MOVE_COLORS[t]}>{t}</Tag> },
                    { title: 'Batch', dataIndex: 'batch_no', className: 'nowrap' },
                    {
                      title: 'Qty',
                      dataIndex: 'quantity',
                      align: 'right',
                      render: (q: number, m: any) => (m.to_location && !m.from_location ? `+${q}` : m.from_location && !m.to_location ? `−${q}` : q),
                    },
                    { title: 'Reference', dataIndex: 'reference' },
                    { title: 'By', dataIndex: 'user_name' },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Drawer>

      <ProductForm
        product={editing}
        onClose={() => setEditing(null)}
        onSaved={(p) => {
          setEditing(null);
          if (selected) setSelected(p);
          load();
        }}
      />
    </Card>
  );
}
