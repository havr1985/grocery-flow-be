import { Injectable } from '@nestjs/common';
import { OrdersRepository } from '@modules/orders/orders.repository';
import { UsersService } from '@modules/users/users.service';
import { DataSource } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { CreateOrderDto } from '@modules/orders/dto/create-order.dto';
import { Order, OrderStatus } from '@modules/orders/entities/order.entity';
import { Product } from '@modules/products/entities/product.entity';
import {
  InsufficientStockException,
  NotFoundException,
} from '@common/exceptions/app.exception';
import { OrderItem } from '@modules/orders/entities/order-item.entity';
import { isUniqueViolation } from '@common/utils/database-error.utils';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OrdersService.name);
  }

  async createOrder(createOrderDto: CreateOrderDto): Promise<Order> {
    await this.usersService.findOne(createOrderDto.userId);
    const existingOrder = await this.ordersRepository.findByIdempotencyKey(
      createOrderDto.userId,
      createOrderDto.idempotencyKey,
    );
    if (existingOrder) {
      this.logger.info(
        {
          orderId: existingOrder.id,
          idempotencyKey: createOrderDto.idempotencyKey,
        },
        'Duplicate order detected, returning existing',
      );
      return existingOrder;
    }
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const productIds = [
        ...new Set(createOrderDto.items.map((item) => item.productId)),
      ];
      const products = await qr.manager
        .createQueryBuilder(Product, 'p')
        .setLock('pessimistic_write')
        .where('p.id IN (:...ids)', { ids: productIds })
        .innerJoinAndSelect('p.farm', 'farm')
        .getMany();

      if (products.length !== productIds.length) {
        const foundIds = new Set(products.map((p) => p.id));
        const missingId = productIds.find((id) => !foundIds.has(id));
        throw new NotFoundException('Product', missingId);
      }

      const productsMap = new Map(products.map((p) => [p.id, p]));
      const orderItems: Partial<OrderItem>[] = [];
      let totalCents = 0;

      for (const item of createOrderDto.items) {
        const product = productsMap.get(item.productId);
        if (!product?.isActive) {
          throw new NotFoundException('Product', item.productId);
        }
        if (product.stock < item.quantity) {
          throw new InsufficientStockException(
            product.id,
            item.quantity,
            product.stock,
          );
        }
        const lineTotalCents = product.priceCents * item.quantity;
        totalCents += lineTotalCents;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          productNameSnapshot: product.name,
          priceCentsSnapshot: product.priceCents,
          farmNameSnapshot: product.farm.name,
          lineTotalCents,
        });
      }
      for (const item of createOrderDto.items) {
        await qr.manager
          .createQueryBuilder()
          .update(Product)
          .set({ stock: () => `stock - ${item.quantity}` })
          .where('id = :id', { id: item.productId })
          .execute();
      }
      const order = qr.manager.create(Order, {
        userId: createOrderDto.userId,
        idempotencyKey: createOrderDto.idempotencyKey,
        status: OrderStatus.PENDING,
        totalCents,
        finalCents: totalCents,
      });

      const savedOrder = await qr.manager.save(order);
      const items = orderItems.map((i) =>
        qr.manager.create(OrderItem, {
          ...i,
          orderId: savedOrder.id,
        }),
      );
      savedOrder.items = await qr.manager.save(items);

      await qr.commitTransaction();

      this.logger.info(
        {
          orderId: savedOrder.id,
          userId: createOrderDto.userId,
          totalCents,
          itemsCount: items.length,
        },
        'Order created successfully',
      );
      return savedOrder;
    } catch (error) {
      await qr.rollbackTransaction();
      if (
        error instanceof NotFoundException ||
        error instanceof InsufficientStockException
      )
        throw error;
      if (isUniqueViolation(error)) {
        this.logger.warn(
          { idempotencyKey: createOrderDto.idempotencyKey },
          'Idempotency race condition — fetching existing order',
        );

        const existing = await this.ordersRepository.findByIdempotencyKey(
          createOrderDto.userId,
          createOrderDto.idempotencyKey,
        );

        if (existing) return existing;
      }

      this.logger.error(
        { userId: createOrderDto.userId },
        'Failed to create order',
      );
      throw error;
    } finally {
      await qr.release();
    }
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException('Order', id);
    }
    return order;
  }

  async findByUser(
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ orders: Order[]; nextCursor: string | null }> {
    await this.usersService.findOne(userId);
    return this.ordersRepository.findByUser(userId, cursor, limit);
  }
}
