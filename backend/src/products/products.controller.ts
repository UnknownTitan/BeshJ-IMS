import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './products.dto';

/** UC1 Manage products. Anyone logged in can view; the Warehouse Manager maintains. */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** GET /api/products?search=coke&includeInactive=false */
  @Get()
  list(@Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.products.list(search, includeInactive === 'true');
  }

  /** GET /api/products/barcode/:code - look up a scanned barcode (or SKU) */
  @Get('barcode/:code')
  byBarcode(@Param('code') code: string) {
    return this.products.byBarcode(code);
  }

  /** GET /api/products/:id - product with unit conversions and batches */
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.products.get(id);
  }

  /** POST /api/products */
  @Post()
  @Roles(Role.WAREHOUSE_MANAGER)
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    return this.products.create(dto, user.userId);
  }

  /** PATCH /api/products/:id - edit, or deactivate with { "is_active": false } */
  @Patch(':id')
  @Roles(Role.WAREHOUSE_MANAGER)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.products.update(id, dto, user.userId);
  }
}
