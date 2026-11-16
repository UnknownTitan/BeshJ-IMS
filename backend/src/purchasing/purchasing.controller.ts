import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { PurchasingService } from './purchasing.service';
import { CreatePurchaseOrderDto, ReceiveGoodsDto, UpdatePurchaseOrderDto } from './purchasing.dto';

/** UC2 purchase orders and UC5 receiving. */
@Controller('purchase-orders')
@Roles(Role.WAREHOUSE_MANAGER, Role.STORE_KEEPER, Role.MANAGEMENT, Role.ACCOUNTANT)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  /** GET /api/purchase-orders?status=APPROVED,SENT */
  @Get()
  list(@Query('status') status?: string) {
    return this.purchasing.list(status);
  }

  /** GET /api/purchase-orders/suggestions - what to reorder (FR4) */
  @Get('suggestions')
  @Roles(Role.WAREHOUSE_MANAGER)
  suggestions() {
    return this.purchasing.suggestions();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.purchasing.get(id);
  }

  @Post()
  @Roles(Role.WAREHOUSE_MANAGER)
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() u: AuthUser) {
    return this.purchasing.create(dto, u.userId);
  }

  @Patch(':id')
  @Roles(Role.WAREHOUSE_MANAGER)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePurchaseOrderDto, @CurrentUser() u: AuthUser) {
    return this.purchasing.update(id, dto, u.userId);
  }

  /** Approver must be a different person from the creator (chk_po_duties). */
  @Post(':id/approve')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER, Role.MANAGEMENT)
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.purchasing.approve(id, u.userId);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  send(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.purchasing.send(id, u.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.purchasing.cancel(id, u.userId);
  }

  @Post(':id/close')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.purchasing.close(id, u.userId);
  }

  /** POST /api/purchase-orders/:id/receive - record a delivery (UC5) */
  @Post(':id/receive')
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  receive(@Param('id', ParseIntPipe) id: number, @Body() dto: ReceiveGoodsDto, @CurrentUser() u: AuthUser) {
    return this.purchasing.receive(id, dto, u.userId);
  }
}
