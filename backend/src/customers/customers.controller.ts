import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { insertRow, updateRow } from '../common/sql';

export class CreateCustomerDto {
  @IsString() @IsNotEmpty() @MaxLength(100) customer_name: string;
  @IsIn(['RETAILER', 'WHOLESALER', 'BAR', 'RESTAURANT']) customer_type: string;
  @IsOptional() @IsString() @MaxLength(80) contact_person?: string;
  @Matches(/^\+?[0-9]{9,14}$/, { message: 'Phone must be 9 to 14 digits' }) phone: string;
  @Matches(/^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$/, { message: 'GPS address must look like GA-183-8164' }) gps_address: string;
  @IsOptional() @IsString() @MaxLength(15) tin?: string | null;
  @IsOptional() @IsIn(['CASH', 'CREDIT']) payment_terms?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) credit_limit?: number;
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

const COLUMNS = [
  'customer_name', 'customer_type', 'contact_person', 'phone', 'gps_address', 'tin', 'payment_terms', 'credit_limit',
] as const;

/** Customers (part of UC9). Sales Reps and Accountants maintain; only Accountants set credit terms. */
@Controller('customers')
export class CustomersController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/customers?search= - with outstanding balance (view v_customer_balance) */
  @Get()
  list(@Query('search') search?: string) {
    return this.db.query(
      `SELECT c.*, b.balance,
              CASE WHEN c.payment_terms = 'CREDIT' THEN c.credit_limit - b.balance END AS credit_available
         FROM customer c JOIN v_customer_balance b ON b.customer_id = c.customer_id
        WHERE ($1::text IS NULL OR c.customer_name ILIKE '%' || $1 || '%' OR c.phone LIKE $1 || '%')
        ORDER BY c.customer_name`,
      [search?.trim() || null],
    );
  }

  /** GET /api/customers/:id - with balance and empties (crates/kegs) held */
  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const row = await this.db.one(
      `SELECT c.*, b.balance FROM customer c JOIN v_customer_balance b ON b.customer_id = c.customer_id
        WHERE c.customer_id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Customer not found');
    const empties = await this.db.query(
      `SELECT container_name, containers_held FROM v_empties_balance WHERE customer_id = $1`,
      [id],
    );
    return { ...row, empties };
  }

  @Post()
  @Roles(Role.SALES_REP, Role.ACCOUNTANT, Role.WAREHOUSE_MANAGER)
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthUser) {
    const data = this.applyCreditRules({ payment_terms: 'CASH', credit_limit: 0, ...dto }, user);
    return this.db.transaction(user.userId, (c) => insertRow(c, 'customer', data, COLUMNS));
  }

  @Patch(':id')
  @Roles(Role.SALES_REP, Role.ACCOUNTANT, Role.WAREHOUSE_MANAGER)
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto, @CurrentUser() user: AuthUser) {
    const current = await this.db.one(`SELECT payment_terms, credit_limit FROM customer WHERE customer_id = $1`, [id]);
    if (!current) throw new NotFoundException('Customer not found');
    const touchesCredit = dto.payment_terms !== undefined || dto.credit_limit !== undefined;
    const data = touchesCredit ? this.applyCreditRules({ ...current, ...dto }, user) : { ...dto };
    return this.db.transaction(user.userId, (c) => updateRow(c, 'customer', 'customer_id', id, data, COLUMNS));
  }

  /**
   * Credit control (FR9): only an Accountant (or Admin) may give a customer
   * credit terms. A cash customer always has a credit limit of 0
   * (same rule as chk_customer_credit in the database).
   */
  private applyCreditRules(data: Record<string, any>, user: AuthUser) {
    const wantsCredit = data.payment_terms === 'CREDIT' || Number(data.credit_limit) > 0;
    if (wantsCredit && ![Role.ACCOUNTANT, Role.ADMIN].includes(user.role)) {
      throw new ForbiddenException('Only an Accountant can set credit terms');
    }
    if (data.payment_terms === 'CASH') {
      if (Number(data.credit_limit) > 0) throw new BadRequestException('A cash customer cannot have a credit limit');
      data.credit_limit = 0;
    }
    return data;
  }
}
