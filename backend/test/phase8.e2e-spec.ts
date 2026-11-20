/**
 * Barcode scanning end-to-end tests (FR2, NFR4). The screens read a barcode from a
 * USB scanner or the device camera, then ask the API which product it belongs to.
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp } from './helpers';

/** EAN-13 check digit rule: weights 1,3,1,3… over the first 12 digits. */
const validEan13 = (code: string) => {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
};

const SAMPLE_PRODUCTS = 9; // product ids 1–9 come from the sample data

describe('Barcode scanning (FR2) (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  it('FR2: a scanned barcode returns the product with its pack sizes, so one scan can count a crate', async () => {
    const keeper = await as(app, 'aowusu');
    const p = (await keeper.get('/api/products/barcode/5449000000101').expect(200)).body;
    expect(p.product_name).toMatch(/Coca-Cola/);
    expect(p.conversions.some((c: any) => c.base_qty === 24)).toBe(true);
  });

  it('FR2: a product SKU works as a code too', async () => {
    const keeper = await as(app, 'aowusu');
    const p = (await keeper.get('/api/products/barcode/CC-300-GL').expect(200)).body;
    expect(p.barcode).toBe('5449000000101');
  });

  it('FR2: an unknown barcode is refused', async () => {
    const keeper = await as(app, 'aowusu');
    await keeper.get('/api/products/barcode/4006381333931').expect(404);
  });

  it('FR2: every sample product has a valid EAN-13 barcode that a scanner can read', async () => {
    const wm = await as(app, 'kmensah');
    const list = (await wm.get('/api/products?includeInactive=true').expect(200)).body;
    const samples = list.filter((p: any) => p.product_id <= SAMPLE_PRODUCTS);
    expect(samples.length).toBe(SAMPLE_PRODUCTS);
    for (const p of samples) expect([p.barcode, validEan13(p.barcode)]).toEqual([p.barcode, true]);
  });

  it('FR2: a scanned product can be matched to its line on a purchase order', async () => {
    const wm = await as(app, 'kmensah');
    const orders = (await wm.get('/api/purchase-orders').expect(200)).body;
    const po = (await wm.get(`/api/purchase-orders/${orders[0].po_id}`).expect(200)).body;
    const line = po.lines[0];
    const product = (await wm.get(`/api/products/${line.product_id}`).expect(200)).body;
    const scanned = (await wm.get(`/api/products/barcode/${product.barcode}`).expect(200)).body;
    expect(scanned.product_id).toBe(line.product_id);
  });
});
