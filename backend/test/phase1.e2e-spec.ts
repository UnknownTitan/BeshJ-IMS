/**
 * Phase 1 end-to-end tests: users, products, suppliers, customers.
 * Each test names the requirement it checks.
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp, uniq } from './helpers';

describe('Phase 1 - master data (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  // ---------------------------------------------------------------- products
  describe('UC1 products (FR1)', () => {
    const newProduct = (n: string) => ({
      sku: `TST-${n}`,
      barcode: `60${n}0001`.slice(0, 13),
      brand: 'Test Brand',
      product_name: `Test Cola ${n}`,
      category_id: 1,
      supplier_id: 1,
      pack_size_ml: 300,
      packaging: 'GLASS',
      base_unit: 'BOTTLE',
      cost_price: 3.0,
      selling_price: 4.0,
      reorder_level: 120,
      container_type_id: 1,
      conversions: [{ unit_name: 'CRATE', base_qty: 24 }],
    });

    it('Warehouse Manager creates a product with a unit conversion (1 crate = 24 bottles)', async () => {
      const wm = await as(app, 'kmensah');
      const res = await wm.post('/api/products', newProduct(uniq())).expect(201);
      expect(res.body.product_id).toBeDefined();
      expect(res.body.conversions).toEqual([{ unit_name: 'CRATE', base_qty: 24 }]);
    });

    it('a Sales Rep cannot create products (FR12)', async () => {
      const rep = await as(app, 'kasante');
      await rep.post('/api/products', newProduct(uniq())).expect(403);
    });

    it('selling price below cost price is rejected', async () => {
      const wm = await as(app, 'kmensah');
      const res = await wm.post('/api/products', { ...newProduct(uniq()), selling_price: 2.5 }).expect(400);
      expect(res.body.message).toMatch(/lower than cost/);
    });

    it('a can cannot have a returnable crate', async () => {
      const wm = await as(app, 'kmensah');
      await wm.post('/api/products', { ...newProduct(uniq()), packaging: 'CAN', base_unit: 'CAN' }).expect(400);
    });

    it('a duplicate SKU is rejected by the database UNIQUE constraint (409)', async () => {
      const wm = await as(app, 'kmensah');
      const res = await wm.post('/api/products', { ...newProduct(uniq()), sku: 'CC-300-GL' }).expect(409);
      expect(res.body.constraint).toBe('product_sku_key');
    });

    it('editing a price is saved and recorded in the audit trail (FR12)', async () => {
      const wm = await as(app, 'kmensah');
      const created = (await wm.post('/api/products', newProduct(uniq())).expect(201)).body;
      await wm.patch(`/api/products/${created.product_id}`, { selling_price: 4.5 }).expect(200);

      const admin = await as(app, 'kappiah');
      const audit = (await admin.get('/api/audit-log?table=product&limit=20').expect(200)).body;
      const entry = audit.find((a: any) => a.record_key === String(created.product_id) && a.operation === 'UPDATE');
      expect(entry.changed_by).toBe('Kwame Mensah');
      expect(Number(entry.old_data.selling_price)).toBe(4);
      expect(Number(entry.new_data.selling_price)).toBe(4.5);
    });

    it('a deactivated product disappears from the default list', async () => {
      const wm = await as(app, 'kmensah');
      const created = (await wm.post('/api/products', newProduct(uniq())).expect(201)).body;
      await wm.patch(`/api/products/${created.product_id}`, { is_active: false }).expect(200);
      const list = (await wm.get('/api/products').expect(200)).body;
      expect(list.some((p: any) => p.product_id === created.product_id)).toBe(false);
    });

    it('a scanned barcode finds its product', async () => {
      const keeper = await as(app, 'aowusu');
      const res = await keeper.get('/api/products/barcode/5449000000103').expect(200);
      expect(res.body.sku).toBe('SP-300-GL');
    });
  });

  // --------------------------------------------------------------- suppliers
  describe('suppliers', () => {
    it('Warehouse Manager adds and edits a supplier', async () => {
      const wm = await as(app, 'kmensah');
      const n = uniq();
      const s = (
        await wm
          .post('/api/suppliers', {
            supplier_name: `Test Supplier ${n}`,
            phone: '0302999999',
            address: 'Spintex Road, Accra',
            tin: `T${n}`,
          })
          .expect(201)
      ).body;
      const res = await wm.patch(`/api/suppliers/${s.supplier_id}`, { contact_person: 'Esi Mensah' }).expect(200);
      expect(res.body.contact_person).toBe('Esi Mensah');
    });
  });

  // --------------------------------------------------------------- customers
  describe('customers and credit control (FR9)', () => {
    const newCustomer = (n: string) => ({
      customer_name: `Test Spot ${n}`,
      customer_type: 'BAR',
      phone: '0244555666',
      gps_address: 'GA-123-4567',
    });

    it('a Sales Rep registers a cash customer', async () => {
      const rep = await as(app, 'kasante');
      const res = await rep.post('/api/customers', newCustomer(uniq())).expect(201);
      expect(res.body.payment_terms).toBe('CASH');
      expect(Number(res.body.credit_limit)).toBe(0);
    });

    it('a Sales Rep cannot give credit', async () => {
      const rep = await as(app, 'kasante');
      const c = (await rep.post('/api/customers', newCustomer(uniq())).expect(201)).body;
      await rep.patch(`/api/customers/${c.customer_id}`, { payment_terms: 'CREDIT', credit_limit: 3000 }).expect(403);
    });

    it('an Accountant can give credit', async () => {
      const rep = await as(app, 'kasante');
      const c = (await rep.post('/api/customers', newCustomer(uniq())).expect(201)).body;
      const acc = await as(app, 'edarko');
      const res = await acc
        .patch(`/api/customers/${c.customer_id}`, { payment_terms: 'CREDIT', credit_limit: 3000 })
        .expect(200);
      expect(Number(res.body.credit_limit)).toBe(3000);
    });

    it('a badly formed GPS address is rejected', async () => {
      const rep = await as(app, 'kasante');
      const res = await rep.post('/api/customers', { ...newCustomer(uniq()), gps_address: 'Osu' }).expect(400);
      expect(String(res.body.message)).toMatch(/GPS address/);
    });

    it('customer list shows the outstanding balance', async () => {
      const acc = await as(app, 'edarko');
      const list = (await acc.get('/api/customers').expect(200)).body;
      expect(list[0]).toHaveProperty('balance');
    });
  });

  // ------------------------------------------------------------------- users
  describe('UC10 users (FR12)', () => {
    it('Admin creates a user who can then log in and change their password', async () => {
      const admin = await as(app, 'kappiah');
      const username = `test.user${uniq()}`;
      await admin
        .post('/api/users', {
          full_name: 'Test Driver',
          username,
          role: 'DRIVER',
          phone: '0200000000',
          password: 'Welcome2026',
        })
        .expect(201);

      const driver = await as(app, username, 'Welcome2026');
      await driver.post('/api/auth/change-password', { current_password: 'Welcome2026', new_password: 'MyNewPass9' }).expect(200);
      const again = await as(app, username, 'MyNewPass9');
      await again.get('/api/auth/me').expect(200);
    });

    it('a weak password is rejected', async () => {
      const admin = await as(app, 'kappiah');
      await admin
        .post('/api/users', { full_name: 'X', username: `weak${uniq()}`, role: 'DRIVER', phone: '0200000000', password: 'short' })
        .expect(400);
    });

    it('a deactivated user can no longer log in', async () => {
      const admin = await as(app, 'kappiah');
      const username = `test.off${uniq()}`;
      const u = (
        await admin
          .post('/api/users', { full_name: 'Leaver', username, role: 'SALES_REP', phone: '0200000000', password: 'Welcome2026' })
          .expect(201)
      ).body;
      await admin.patch(`/api/users/${u.user_id}`, { is_active: false }).expect(200);
      const res = await (await import('supertest'))
        .default(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: 'Welcome2026' });
      expect(res.status).toBe(401);
    });

    it('an Admin cannot deactivate themselves', async () => {
      const admin = await as(app, 'kappiah');
      await admin.patch('/api/users/1', { is_active: false }).expect(400);
    });
  });
});
