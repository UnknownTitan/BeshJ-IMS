import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { insertRow, updateRow } from '../common/sql';

export class CreateSupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(100) supplier_name: string;
  @IsOptional() @IsString() @MaxLength(80) contact_person?: string;
  @Matches(/^\+?[0-9]{9,14}$/, { message: 'Phone must be 9 to 14 digits' }) phone: string;
  @IsOptional() @IsEmail() @MaxLength(100) email?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(150) address: string;
  @IsString() @IsNotEmpty() @MaxLength(15) tin: string;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

const COLUMNS = ['supplier_name', 'contact_person', 'phone', 'email', 'address', 'tin'] as const;

/** Suppliers / manufacturers. Anyone can view; the Warehouse Manager maintains. */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/suppliers - with how many active products each supplies */
  @Get()
  list() {
    return this.db.query(
      `SELECT s.*, COUNT(p.product_id) FILTER (WHERE p.is_active)::int AS product_count
         FROM supplier s LEFT JOIN product p ON p.supplier_id = s.supplier_id
        GROUP BY s.supplier_id ORDER BY s.supplier_name`,
    );
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const row = await this.db.one(`SELECT * FROM supplier WHERE supplier_id = $1`, [id]);
    if (!row) throw new NotFoundException('Supplier not found');
    return row;
  }

  @Post()
  @Roles(Role.WAREHOUSE_MANAGER)
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.db.transaction(user.userId, (c) => insertRow(c, 'supplier', { ...dto }, COLUMNS));
  }

  @Patch(':id')
  @Roles(Role.WAREHOUSE_MANAGER)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.db.transaction(user.userId, (c) => updateRow(c, 'supplier', 'supplier_id', id, { ...dto }, COLUMNS));
  }
}
