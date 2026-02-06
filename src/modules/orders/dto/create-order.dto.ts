import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @ApiProperty({
    description: 'Product Id',
    example: '3d7e7d48-5444-403b-957a-5f39752e8ec6',
  })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity to order', example: 2, minimum: 1 })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({
    description: 'User Id',
    example: '91972ffc-c0b6-4996-94a0-d5a1bc442f47',
  })
  @IsNotEmpty()
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate orders',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsString()
  idempotencyKey: string;

  @ApiProperty({
    description: 'Order items (at least one required)',
    type: [CreateOrderItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
