import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { OrdersService } from '@modules/orders/orders.service';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateOrderDto } from '@modules/orders/dto/create-order.dto';
import { OrderResponseDto } from '@modules/orders/dto/order-response.dto';

@Controller('orders')
@ApiTags('Orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new order',
    description:
      'Creates an order transactionally with stock validation and idempotency protection. ' +
      'If the same idempotencyKey is sent again, the existing order is returned.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Order created successfully',
    type: OrderResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Duplicate request — existing order returned (idempotency)',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Insufficient stock',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Product not found',
  })
  async create(
    @Body() createOrderDto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.createOrder(createOrderDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order found',
    type: OrderResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOne(id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get orders by user (keyset pagination)' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor (createdAt ISO string) for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of orders per page (default: 20)',
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of user orders',
  })
  async findByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.findByUser(userId, cursor, limit ?? 20);
  }
}
