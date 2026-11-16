import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ProductsController } from './products/products.controller';
import { StockController } from './stock/stock.controller';
import { UsersController } from './users/users.controller';

/**
 * Modular monolith (Assignment 8, AD3). Each business area gets its own
 * folder; as phases progress, controllers grow into full modules
 * (controller + service + DTOs): purchasing, receiving, orders, invoices,
 * empties, vans, reports.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule],
  controllers: [HealthController, ProductsController, StockController, UsersController],
})
export class AppModule {}
