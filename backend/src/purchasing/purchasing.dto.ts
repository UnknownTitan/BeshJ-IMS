import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PoLineDto {
  @IsInt() product_id: number;
  /** Always in the product's base unit (bottles, cans or kegs). */
  @IsInt() @Min(1) quantity: number;
  /** Defaults to the product's cost price. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unit_cost?: number;
}

export class CreatePurchaseOrderDto {
  @IsInt() supplier_id: number;
  @IsOptional() @IsDateString() expected_date?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product' })
  @ArrayUnique((l: PoLineDto) => l.product_id, { message: 'Each product can only appear once' })
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines: PoLineDto[];
}

/** Only DRAFT orders can be edited; the lines are replaced as a whole. */
export class UpdatePurchaseOrderDto {
  @IsOptional() @IsDateString() expected_date?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product' })
  @ArrayUnique((l: PoLineDto) => l.product_id, { message: 'Each product can only appear once' })
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines?: PoLineDto[];
}

export class ReceiveLineDto {
  @IsInt() line_no: number;
  /** Good units put into stock. */
  @IsInt() @Min(0) qty_received: number;
  /** Units that arrived broken or leaking; not put into stock. */
  @IsOptional() @IsInt() @Min(0) qty_damaged?: number;

  @ValidateIf((l) => (l.qty_damaged ?? 0) > 0)
  @IsString()
  @IsNotEmpty({ message: 'Say what was wrong with the damaged units' })
  @MaxLength(200)
  damage_note?: string;

  @ValidateIf((l) => l.qty_received > 0)
  @IsString()
  @IsNotEmpty({ message: 'Batch number is required for received goods' })
  @MaxLength(20)
  batch_no?: string;

  @ValidateIf((l) => l.qty_received > 0)
  @IsDateString({}, { message: 'Expiry date is required for received goods' })
  expiry_date?: string;
}

export class ReceiveGoodsDto {
  @IsString() @IsNotEmpty() @MaxLength(30) delivery_note_no: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
  /** Warehouse receiving the goods. Defaults to the Main Warehouse. */
  @IsOptional() @IsInt() location_id?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((l: ReceiveLineDto) => l.line_no)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];
}
