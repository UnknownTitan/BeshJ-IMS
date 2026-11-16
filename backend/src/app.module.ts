import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { CustomersController } from './customers/customers.controller';
import { LookupsController } from './lookups/lookups.controller';
import { StockController } from './stock/stock.controller';
import { UsersController } from './users/users.controller';
import { PurchasingController } from './purchasing/purchasing.controller';
import { PurchasingService } from './purchasing/purchasing.service';

/**
 * Modular monolith (Assignment 8, AD3). Each business area has its own
 * folder: controller (HTTP + roles), DTOs (validation) and, where the logic
 * is larger, a service. Later phases add purchasing, receiving, orders,
 * invoices, empties, vans and reports the same way.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule],
  controllers: [
    HealthController,
    ProductsController,
    SuppliersController,
    CustomersController,
    LookupsController,
    StockController,
    UsersController,
    PurchasingController,
  ],
  providers: [ProductsService, PurchasingService],
})
export class AppModule {}
