import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// The same rules as the CHECK constraints in 01_schema.sql, so users get a
// friendly message before the database has to reject anything.

export class UnitConversionDto {
  @IsIn(['CRATE', 'CARTON', 'PACK', 'KEG']) unit_name: string;
  @IsInt() @Min(1) base_qty: number;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(20) sku: string;

  @IsOptional() @Matches(/^[0-9]{8,13}$/, { message: 'Barcode must be 8 to 13 digits' }) barcode?: string | null;

  @IsString() @IsNotEmpty() @MaxLength(50) brand: string;
  @IsString() @IsNotEmpty() @MaxLength(100) product_name: string;
  @IsInt() category_id: number;
  @IsInt() supplier_id: number;
  @IsInt() @Min(1) pack_size_ml: number;
  @IsIn(['CAN', 'PET', 'GLASS', 'KEG']) packaging: string;
  @IsIn(['BOTTLE', 'CAN', 'KEG']) base_unit: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cost_price: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) selling_price: number;
  @IsInt() @Min(0) reorder_level: number;
  @IsOptional() @IsInt() container_type_id?: number | null;
  @IsOptional() @IsBoolean() is_active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique((c: UnitConversionDto) => c.unit_name, { message: 'Each unit can only be listed once' })
  @ValidateNested({ each: true })
  @Type(() => UnitConversionDto)
  conversions?: UnitConversionDto[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

/** Columns a client may write. Anything else in the body is ignored. */
export const PRODUCT_COLUMNS = [
  'sku', 'barcode', 'brand', 'product_name', 'category_id', 'supplier_id', 'pack_size_ml',
  'packaging', 'base_unit', 'cost_price', 'selling_price', 'reorder_level', 'container_type_id', 'is_active',
] as const;
