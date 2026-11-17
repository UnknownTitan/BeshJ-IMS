import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
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

export class OrderLineDto {
  @IsInt() product_id: number;
  /** In the product's base unit (bottles, cans or kegs). */
  @IsInt() @Min(1) quantity: number;
  /** Only Warehouse Managers and Accountants may change the price; others get the list price. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unit_price?: number;
}

export class CreateOrderDto {
  @IsInt() customer_id: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product' })
  @ArrayUnique((l: OrderLineDto) => l.product_id, { message: 'Each product can only appear once' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines: OrderLineDto[];
}

export class UpdateOrderDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product' })
  @ArrayUnique((l: OrderLineDto) => l.product_id, { message: 'Each product can only appear once' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines: OrderLineDto[];
}

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;

export class CreatePaymentDto {
  @IsInt() customer_id: number;
  /** Leave out to record money on account (not tied to one invoice). */
  @IsOptional() @IsInt() invoice_id?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsIn(PAYMENT_METHODS) payment_method: string;

  /** MoMo transaction ID, bank reference or cheque number. Required except for cash. */
  @ValidateIf((p) => p.payment_method !== 'CASH')
  @IsString()
  @IsNotEmpty({ message: 'Enter the transaction reference (MoMo ID, bank reference or cheque number)' })
  @MaxLength(30)
  reference?: string;

  @IsOptional() @IsDateString() payment_date?: string;
}

export class DeliverDto {
  /** The van that delivered the goods (a stock_location of type VAN). */
  @IsOptional() @IsInt() van_id?: number;
}
