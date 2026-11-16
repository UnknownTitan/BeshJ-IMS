import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/pg-exception.filter';

export const PASSWORD = 'Password123!';

/** Start the whole API in memory, configured exactly like main.ts. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** Log in and return a function that makes authenticated requests. */
export async function as(app: INestApplication, username: string, password = PASSWORD) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username, password });
  const token = res.body.accessToken as string;
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => request(server).post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => request(server).patch(url).set('Authorization', `Bearer ${token}`).send(body),
  };
}

/** A short unique suffix so tests can be re-run without resetting the database. */
export const uniq = () => Date.now().toString().slice(-7);
