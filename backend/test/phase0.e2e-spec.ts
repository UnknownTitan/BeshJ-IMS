/**
 * Phase 0 end-to-end tests. They run the real API against the real
 * database, so reset it first:  database/reset_db.sh
 *
 * Each test names the functional requirement it checks (FR1-FR12).
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/pg-exception.filter';

const PASSWORD = 'Password123!';

describe('Phase 0 - foundation (e2e)', () => {
  let app: INestApplication;

  const login = async (username: string) =>
    (await request(app.getHttpServer()).post('/api/auth/login').send({ username, password: PASSWORD })).body
      .accessToken as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  it('API is up and reaches the database (27 tables)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.database).toBe('connected');
    expect(res.body.tables).toBe(27);
  });

  it('FR12: a valid user can log in and receives their role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'kmensah', password: PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('WAREHOUSE_MANAGER');
  });

  it('FR12: a wrong password is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'kmensah', password: 'wrong' })
      .expect(401);
  });

  it('FR12: endpoints need a login', async () => {
    await request(app.getHttpServer()).get('/api/products').expect(401);
  });

  it('FR12: a Sales Rep cannot list users (Admin only)', async () => {
    const token = await login('kasante');
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('FR12: every login is written to the audit trail', async () => {
    const token = await login('kappiah');
    const res = await request(app.getHttpServer())
      .get('/api/audit-log?table=app_user')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.some((r: any) => r.operation === 'LOGIN')).toBe(true);
  });

  it('FR1: products list shows warehouse stock', async () => {
    const token = await login('kmensah');
    const res = await request(app.getHttpServer()).get('/api/products').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(typeof res.body[0].warehouse_qty).toBe('number');
  });

  it('FR4: reorder alerts list exactly the products at or below their reorder level', async () => {
    const token = await login('kmensah');
    const auth = { Authorization: `Bearer ${token}` };
    const alerts = (await request(app.getHttpServer()).get('/api/stock/reorder-alerts').set(auth).expect(200)).body;
    const products = (await request(app.getHttpServer()).get('/api/products').set(auth).expect(200)).body;
    const low = products.filter((p: any) => p.warehouse_qty <= p.reorder_level).map((p: any) => p.sku).sort();
    expect(alerts.map((a: any) => a.sku).sort()).toEqual(low);
  });

  it('FR5: FEFO picks the earliest-expiring batch first', async () => {
    const token = await login('aowusu');
    const res = await request(app.getHttpServer())
      .get('/api/stock/fefo?productId=1&locationId=1&quantity=500')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const dates = res.body.map((r: any) => r.expiry_date);
    expect([...dates].sort()).toEqual(dates);
    expect(res.body.reduce((n: number, r: any) => n + r.qty_to_pick, 0)).toBe(500);
  });

  it('FR5: FEFO refuses to allocate more than is in stock', async () => {
    const token = await login('aowusu');
    const res = await request(app.getHttpServer())
      .get('/api/stock/fefo?productId=1&locationId=1&quantity=999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(res.body.message).toMatch(/Insufficient stock/);
  });
});
