import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { OrdersService } from './orders.service';
import { CreateOrderDto, CreatePaymentDto, DeliverDto, UpdateOrderDto } from './sales.dto';

const SALES_VIEW = [Role.SALES_REP, Role.ACCOUNTANT, Role.WAREHOUSE_MANAGER, Role.STORE_KEEPER, Role.MANAGEMENT, Role.DRIVER];

/** UC9 Customer orders. */
@Controller('orders')
@Roles(...SALES_VIEW)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** GET /api/orders?status=CONFIRMED,PICKING&customerId=2&mine=true */
  @Get()
  list(
    @CurrentUser() u: AuthUser,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('mine') mine?: string,
  ) {
    return this.orders.list({
      status,
      customerId: customerId ? Number(customerId) : undefined,
      repId: mine === 'true' ? u.userId : undefined,
    });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.orders.get(id);
  }

  @Post()
  @Roles(Role.SALES_REP, Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT)
  create(@Body() dto: CreateOrderDto, @CurrentUser() u: AuthUser) {
    return this.orders.create(dto, u);
  }

  @Patch(':id')
  @Roles(Role.SALES_REP, Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto, @CurrentUser() u: AuthUser) {
    return this.orders.update(id, dto.lines, u);
  }

  /** Check stock and credit; CONFIRMED or PENDING_CREDIT_APPROVAL. */
  @Post(':id/submit')
  @HttpCode(200)
  @Roles(Role.SALES_REP, Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT)
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.orders.submit(id, u);
  }

  @Post(':id/approve-credit')
  @HttpCode(200)
  @Roles(Role.ACCOUNTANT)
  approveCredit(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.orders.approveCredit(id, u);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.SALES_REP, Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.orders.cancel(id, u);
  }

  /** Pick stock (FEFO) and issue the VAT invoice: one transaction. With {van_id}, a van sale from the van's stock. */
  @Post(':id/invoice')
  @HttpCode(200)
  @Roles(Role.SALES_REP, Role.ACCOUNTANT, Role.WAREHOUSE_MANAGER, Role.STORE_KEEPER)
  invoice(@Param('id', ParseIntPipe) id: number, @Body() dto: DeliverDto, @CurrentUser() u: AuthUser) {
    return this.orders.invoice(id, u, dto.van_id);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @Roles(Role.SALES_REP, Role.DRIVER, Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  deliver(@Param('id', ParseIntPipe) id: number, @Body() dto: DeliverDto, @CurrentUser() u: AuthUser) {
    return this.orders.deliver(id, dto.van_id, u);
  }
}

/** Invoices and payments (FR10). */
@Controller()
@Roles(...SALES_VIEW)
export class InvoicesController {
  constructor(private readonly db: DatabaseService, private readonly orders: OrdersService) {}

  /** GET /api/invoices?unpaid=true&customerId=2 - with paid / outstanding / days overdue */
  @Get('invoices')
  list(@Query('unpaid') unpaid?: string, @Query('customerId') customerId?: string) {
    return this.db.query(
      `SELECT * FROM v_invoice_balance
        WHERE ($1::boolean IS NOT TRUE OR outstanding > 0)
          AND ($2::int IS NULL OR customer_id = $2)
        ORDER BY invoice_id DESC`,
      [unpaid === 'true', customerId ? Number(customerId) : null],
    );
  }

  /** GET /api/invoices/:id - the full invoice (via its order) */
  @Get('invoices/:id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const row = await this.db.one(`SELECT order_id FROM invoice WHERE invoice_id = $1`, [id]);
    if (!row) throw new NotFoundException('Invoice not found');
    return this.orders.get(row.order_id);
  }

  /** GET /api/tax-rates - the tax components in force today */
  @Get('tax-rates')
  taxRates() {
    return this.db.query(
      `SELECT tax_code, tax_name, rate_percent, effective_from FROM tax_rate
        WHERE effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
        ORDER BY rate_percent DESC`,
    );
  }

  /** GET /api/payments?customerId=2 */
  @Get('payments')
  payments(@Query('customerId') customerId?: string) {
    return this.db.query(
      `SELECT p.*, c.customer_name, i.invoice_no, u.full_name AS received_by_name
         FROM payment p
         JOIN customer c ON c.customer_id = p.customer_id
         JOIN app_user u ON u.user_id = p.received_by
         LEFT JOIN invoice i ON i.invoice_id = p.invoice_id
        WHERE ($1::int IS NULL OR p.customer_id = $1)
        ORDER BY p.payment_id DESC LIMIT 200`,
      [customerId ? Number(customerId) : null],
    );
  }

  /**
   * POST /api/payments - record money received. The database refuses overpayment
   * (trg_payment_check). When an invoice is paid in full and its goods were
   * delivered, the order becomes PAID.
   */
  @Post('payments')
  @Roles(Role.ACCOUNTANT, Role.SALES_REP, Role.DRIVER)
  async pay(@Body() dto: CreatePaymentDto, @CurrentUser() u: AuthUser) {
    const today = new Date().toISOString().slice(0, 10);
    if (dto.payment_date && dto.payment_date.slice(0, 10) > today) {
      throw new BadRequestException('Payment date cannot be in the future');
    }
    return this.db.transaction(u.userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO payment (customer_id, invoice_id, amount, payment_method, payment_date, received_by, reference)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7) RETURNING *`,
        [dto.customer_id, dto.invoice_id ?? null, dto.amount, dto.payment_method, dto.payment_date || null, u.userId, dto.reference || null],
      );
      let orderStatus: string | null = null;
      if (dto.invoice_id) {
        const { rows: bal } = await c.query(
          `SELECT ib.outstanding, o.order_id, o.status FROM v_invoice_balance ib
             JOIN customer_order o ON o.order_id = ib.order_id WHERE ib.invoice_id = $1`,
          [dto.invoice_id],
        );
        orderStatus = bal[0].status;
        if (Number(bal[0].outstanding) === 0 && bal[0].status === 'DELIVERED') {
          await c.query(`UPDATE customer_order SET status = 'PAID' WHERE order_id = $1`, [bal[0].order_id]);
          orderStatus = 'PAID';
        }
      }
      return { ...rows[0], order_status: orderStatus };
    });
  }
}
