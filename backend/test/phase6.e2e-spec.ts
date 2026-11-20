/**
 * Van management end-to-end tests (UC6, FR6, FR12): adding, editing and
 * retiring vans, assigning drivers, and loading from each van's home depot.
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp, uniq } from './helpers';

const MAIN = 1;
const KUMASI_DEPOT = 2;
const VAN_1 = 3; // driver yboateng
const VAN_3 = 5; // Van 3 - Kumasi, home Kumasi Depot, no driver
const ALOMO = 9; // only stocked at the Kumasi Depot

describe('Van management (UC6, FR6) (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const wm = () => as(app, 'kmensah');
  const keeper = () => as(app, 'aowusu');
  const reg = () => `GT-${uniq().slice(-4)}-26`;

  /** A new active user with the Driver role. */
  const newDriver = async () => {
    const n = uniq() + Math.floor(Math.random() * 100);
    const admin = await as(app, 'kappiah');
    const u = (
      await admin
        .post('/api/users', { full_name: `Test Driver ${n}`, username: `drv${n}`, role: 'DRIVER', phone: '0244000000', password: 'Temp-Pass-123' })
        .expect(201)
    ).body;
    return u.user_id as number;
  };

  describe('adding and editing vans', () => {
    it('FR6: a Warehouse Manager adds a van with a home depot and driver; it is audited (FR12)', async () => {
      const m = await wm();
      const driver = await newDriver();
      const r = reg();
      const van = (
        await m.post('/api/vans', { location_name: `Van T${uniq()}`, vehicle_reg: ` ${r.toLowerCase()} `, home_location_id: MAIN, driver_id: driver }).expect(201)
      ).body;
      expect(van).toMatchObject({ vehicle_reg: r, home_location_id: MAIN, home_name: 'Main Warehouse - Accra', driver_id: driver, is_active: true, units_on_board: 0 });

      const audit = (await (await as(app, 'aadjei')).get('/api/audit-log?table=stock_location').expect(200)).body;
      const rows = Array.isArray(audit) ? audit : audit.rows;
      expect(rows.some((a: any) => a.table_name === 'stock_location' && String(a.record_key) === String(van.van_id))).toBe(true);
    });

    it('other roles cannot add or edit vans', async () => {
      const k = await keeper();
      await k.post('/api/vans', { location_name: 'Nope', vehicle_reg: reg(), home_location_id: MAIN }).expect(403);
      await (await as(app, 'kasante')).patch(`/api/vans/${VAN_3}`, { location_name: 'Nope' }).expect(403);
    });

    it('duplicate names, registrations and drivers are refused with a clear message', async () => {
      const m = await wm();
      await m.post('/api/vans', { location_name: 'Van 1 - Accra Central', vehicle_reg: reg(), home_location_id: MAIN }).expect(400);
      const dupReg = await m.post('/api/vans', { location_name: `Van D${uniq()}`, vehicle_reg: 'gr-4521-22', home_location_id: MAIN }).expect(400);
      expect(dupReg.body.message).toMatch(/Van 1 - Accra Central already has that registration/);
      const dupDriver = await m.post('/api/vans', { location_name: `Van E${uniq()}`, vehicle_reg: reg(), home_location_id: MAIN, driver_id: 6 }).expect(400);
      expect(dupDriver.body.message).toMatch(/already assigned to Van 1/);
    });

    it('the database refuses a non-driver as driver and a van as home depot', async () => {
      const m = await wm();
      const notDriver = await m.post('/api/vans', { location_name: `Van F${uniq()}`, vehicle_reg: reg(), home_location_id: MAIN, driver_id: 4 }).expect(400);
      expect(notDriver.body.message).toMatch(/Driver role/);
      const badHome = await m.post('/api/vans', { location_name: `Van G${uniq()}`, vehicle_reg: reg(), home_location_id: VAN_1 }).expect(400);
      expect(badHome.body.message).toMatch(/home depot must be an active warehouse/);
    });

    it('a driver can be moved from one van to another', async () => {
      const m = await wm();
      const driver = await newDriver();
      const a = (await m.post('/api/vans', { location_name: `Van H${uniq()}`, vehicle_reg: reg(), home_location_id: MAIN, driver_id: driver }).expect(201)).body;
      const b = (await m.post('/api/vans', { location_name: `Van I${uniq()}`, vehicle_reg: reg(), home_location_id: KUMASI_DEPOT }).expect(201)).body;
      await m.patch(`/api/vans/${b.van_id}`, { driver_id: driver }).expect(400); // still on van a
      expect((await m.patch(`/api/vans/${a.van_id}`, { driver_id: null }).expect(200)).body.driver_id).toBeNull();
      expect((await m.patch(`/api/vans/${b.van_id}`, { driver_id: driver }).expect(200)).body.driver_name).toMatch(/Test Driver/);
    });
  });

  describe('home depot and trips', () => {
    it('a van loads from its home depot and returns stock there', async () => {
      const m = await wm();
      const k = await keeper();
      const driver = await newDriver();
      await m.patch(`/api/vans/${VAN_3}`, { driver_id: driver }).expect(200);

      const kumasiQty = async () =>
        (await k.get('/api/stock/on-hand').expect(200)).body
          .filter((r: any) => r.product_id === ALOMO && r.location_name === 'Kumasi Depot')
          .reduce((s: number, r: any) => s + Number(r.qty_on_hand), 0);
      const before = await kumasiQty();

      const trip = (await k.post('/api/van-trips', { van_id: VAN_3, lines: [{ product_id: ALOMO, quantity: 24 }] }).expect(201)).body;
      expect(trip.depot_name).toBe('Kumasi Depot');
      expect(await kumasiQty()).toBe(before - 24);

      // While the van is out, its driver, depot and status are locked
      const locked = await m.patch(`/api/vans/${VAN_3}`, { driver_id: null }).expect(400);
      expect(locked.body.message).toMatch(/out on trip/);
      await m.patch(`/api/vans/${VAN_3}`, { is_active: false }).expect(400);
      // ...but it can still be renamed
      await m.patch(`/api/vans/${VAN_3}`, { location_name: 'Van 3 - Kumasi' }).expect(200);

      await k.post(`/api/van-trips/${trip.trip_id}/reconcile`, { cash_declared: 0, lines: [{ product_id: ALOMO, qty_returned: 24, qty_damaged: 0 }] }).expect(200);
      expect(await kumasiQty()).toBe(before);

      await m.patch(`/api/vans/${VAN_3}`, { driver_id: null }).expect(200);
    });

    it('a retired van loses its driver, cannot be loaded, and can be brought back', async () => {
      const m = await wm();
      const driver = await newDriver();
      const van = (await m.post('/api/vans', { location_name: `Van R${uniq()}`, vehicle_reg: reg(), home_location_id: MAIN, driver_id: driver }).expect(201)).body;

      const retired = (await m.patch(`/api/vans/${van.van_id}`, { is_active: false }).expect(200)).body;
      expect(retired).toMatchObject({ is_active: false, driver_id: null });

      const load = await (await keeper()).post('/api/van-trips', { van_id: van.van_id, lines: [{ product_id: 1, quantity: 24 }] }).expect(400);
      expect(load.body.message).toMatch(/retired/);

      const locations = (await m.get('/api/locations').expect(200)).body;
      expect(locations.some((l: any) => l.location_id === van.van_id)).toBe(false);

      expect((await m.patch(`/api/vans/${van.van_id}`, { is_active: true }).expect(200)).body.is_active).toBe(true);
    });

    it('a warehouse with vans based at it cannot be retired (database rule)', async () => {
      // Checked straight in the database: there is no warehouse screen yet.
      const db = app.get(require('../src/database/database.service').DatabaseService);
      await expect(db.query(`UPDATE stock_location SET is_active = false WHERE location_id = $1`, [KUMASI_DEPOT])).rejects.toThrow(
        /still holds stock|Vans are based at/,
      );
    });
  });
});
