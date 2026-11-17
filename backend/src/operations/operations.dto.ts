import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ------------------------------------------------------------ write-offs
export const WRITE_OFF_REASONS = ['BROKEN', 'LEAKING', 'EXPIRED', 'DAMAGED_IN_TRANSIT', 'THEFT', 'OTHER'] as const;

export class CreateWriteOffDto {
  @IsInt() batch_id: number;
  @IsInt() @Min(1) quantity: number;
  @IsIn(WRITE_OFF_REASONS) reason_code: string;
  @IsString() @IsNotEmpty({ message: 'Describe what happened' }) @MaxLength(200) description: string;
  /** The person responsible, if any (e.g. the driver or loader). */
  @IsOptional() @IsInt() responsible_user_id?: number;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

// -------------------------------------------------------------- empties
export class ContainerQtyDto {
  @IsInt() container_type_id: number;
  @IsInt() @Min(1) quantity: number;
}

export class CustomerReturnDto {
  @IsInt() customer_id: number;
  /** CREDIT: deposit taken off what the customer owes. CASH: deposit handed back in cash. */
  @IsIn(['CREDIT', 'CASH']) refund_method: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((l: ContainerQtyDto) => l.container_type_id)
  @ValidateNested({ each: true })
  @Type(() => ContainerQtyDto)
  lines: ContainerQtyDto[];
}

export class SupplierReturnDto {
  @IsInt() supplier_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((l: ContainerQtyDto) => l.container_type_id)
  @ValidateNested({ each: true })
  @Type(() => ContainerQtyDto)
  lines: ContainerQtyDto[];
}

// ------------------------------------------------------------ van trips
export class LoadLineDto {
  @IsInt() product_id: number;
  @IsInt() @Min(1) quantity: number;
}

export class CreateTripDto {
  @IsInt() van_id: number;
  /** Defaults to the van's assigned driver. */
  @IsOptional() @IsInt() driver_id?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Load at least one product' })
  @ArrayUnique((l: LoadLineDto) => l.product_id, { message: 'Each product can only appear once' })
  @ValidateNested({ each: true })
  @Type(() => LoadLineDto)
  lines: LoadLineDto[];
}

export class ReconcileLineDto {
  @IsInt() product_id: number;
  /** Good units counted back into the warehouse. */
  @IsInt() @Min(0) qty_returned: number;
  /** Units that came back broken or leaking. */
  @IsInt() @Min(0) qty_damaged: number;
}

export class ReconcileTripDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cash_declared: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;

  @IsArray()
  @ArrayUnique((l: ReconcileLineDto) => l.product_id)
  @ValidateNested({ each: true })
  @Type(() => ReconcileLineDto)
  lines: ReconcileLineDto[];
}

// ------------------------------------------------------------ stocktake
export class StartStocktakeDto {
  @IsInt() location_id: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class CountDto {
  @IsInt() batch_id: number;
  @IsInt() @Min(0) counted_qty: number;
}

export class SaveCountsDto {
  @IsArray()
  @ArrayUnique((c: CountDto) => c.batch_id)
  @ValidateNested({ each: true })
  @Type(() => CountDto)
  counts: CountDto[];
}
