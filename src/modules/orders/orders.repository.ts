import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '@modules/orders/entities/order.entity';
import { Repository } from 'typeorm';

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
  ) {}

  async findById(id: string): Promise<Order | null> {
    return this.ordersRepository.findOne({
      where: { id },
      relations: { items: true },
    });
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<Order | null> {
    return this.ordersRepository.findOne({
      where: { userId, idempotencyKey },
      relations: { items: true },
    });
  }

  async findByUser(
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ orders: Order[]; nextCursor: string | null }> {
    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .where('order.userId = :userId', { userId })
      .orderBy('order.createdAt', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('order.createdAt < :cursor', { cursor });
    }
    const orders = await qb.getMany();

    const hasNext = orders.length > limit;
    if (hasNext) orders.pop();

    const nextCursor = hasNext
      ? orders[orders.length - 1].createdAt.toISOString()
      : null;

    return { orders: orders, nextCursor };
  }
}
