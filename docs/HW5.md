# Homework 05 — Транзакційне створення замовлення

## Огляд

Реалізовано безпечне транзакційне створення замовлення з:
- Ідемпотентністю (double-submit protection)
- Захистом від oversell (pessimistic locking)
- Оптимізацією SQL-запитів (composite indexes)

---

## Частина 1 — Транзакція

### 1.1 Ідемпотентність

**Механізм:** `UNIQUE(user_id, idempotency_key)` constraint в таблиці `orders`.

```typescript
// order.entity.ts
@Index('IDX_orders_user_idempotency', ['userId', 'idempotencyKey'], { unique: true })
```

**Як працює:**

1. Клієнт генерує UUID перед запитом
2. Надсилає як `idempotencyKey` в body
3. Сервер перевіряє чи існує замовлення з таким ключем
4. Якщо існує — повертає існуюче (200)
5. Якщо ні — створює нове (201)

**Race condition handling:**

Якщо два однакові запити прийшли одночасно, перша перевірка може пропустити обидва. БД кидає unique constraint violation (code 23505), яку ми ловимо в catch і повертаємо існуюче замовлення.

```typescript
if (isUniqueViolation(error)) {
  const existing = await this.ordersRepository.findByIdempotencyKey(
    createOrderDto.userId,
    createOrderDto.idempotencyKey,
  );
  if (existing) return existing;
}
```

### 1.2 Транзакція (QueryRunner)

Весь процес виконується в одній транзакції:

**Структура коду:**

```typescript
const qr = this.dataSource.createQueryRunner();
await qr.connect();
await qr.startTransaction();

try {
  // ... бізнес-логіка
  await qr.commitTransaction();
} catch (error) {
  await qr.rollbackTransaction();
  // ... обробка помилок
  throw error;
} finally {
  await qr.release(); // ЗАВЖДИ викликається
}
```

### 1.3 Захист від Oversell — Pessimistic Locking

**Обраний підхід:** `SELECT ... FOR UPDATE` (pessimistic write lock)

```typescript
const products = await qr.manager
  .createQueryBuilder(Product, 'p')
  .setLock('pessimistic_write')
  .where('p.id IN (:...ids)', { ids: productIds })
  .innerJoinAndSelect('p.farm', 'farm')
  .getMany();
```

**Сценарій FarmBox:** "П'ятниця вечір, 5 покупців на останні 3 кг полуниці" — висока конкуренція за обмежений ресурс. Pessimistic lock гарантує що тільки один запит обробляє товар в момент часу.

**Atomic stock update:**

```typescript
await qr.manager
  .createQueryBuilder()
  .update(Product)
  .set({ stock: () => `stock - ${item.quantity}` })
  .where('id = :id', { id: item.productId })
  .execute();
```

### 1.4 Обробка помилок

| Ситуація | HTTP код | Exception |
|----------|----------|-----------|
| Недостатній stock | 409 Conflict | `InsufficientStockException` |
| Продукт не знайдено | 404 Not Found | `NotFoundException` |
| Duplicate idempotencyKey | 200 OK | Повертає існуючий order |
| Інша помилка | 500 | Rollback + rethrow |

---

## Частина 2 — SQL-оптимізація

### Обраний запит

**"Гарячий" запит:** Список замовлень користувача з фільтрами по статусу та даті.

```sql
SELECT o.id, o.user_id, o.status, o.created_at,
       oi.product_id, oi.quantity
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.user_id = '...'
  AND o.status = 'pending'
  AND o.created_at >= '2025-01-01'
  AND o.created_at <= '2026-02-01'
ORDER BY o.created_at DESC
LIMIT 20;
```

### EXPLAIN ANALYZE — ДО оптимізації

```
Limit  (cost=0.42..15.71 rows=20 width=64) (actual time=0.031..0.075 rows=20 loops=1)
  Buffers: shared hit=78
  ->  Nested Loop Left Join
        ->  Index Scan Backward using "IDX_orders_created_at" on orders o
              Index Cond: ((created_at >= ...) AND (created_at <= ...))
              Filter: ((user_id = '...') AND (status = 'pending'))
              Rows Removed by Filter: 37    ← ПРОБЛЕМА
              Buffers: shared hit=58
        ->  Index Scan using "IDX_order_items_order_id" on order_items oi
```

**Проблеми:**
- Використовується індекс тільки по `created_at`
- `Rows Removed by Filter: 37` — зайві рядки фільтруються в пам'яті
- `Buffers: 78` — читає більше сторінок ніж потрібно

### Оптимізація — Композитні індекси

```sql
CREATE INDEX IDX_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IDX_orders_status_created ON orders(status, created_at DESC);
```

**Міграція:** `src/migrations/1770372223831-AddOrdersIndexes.ts`

### EXPLAIN ANALYZE — ПІСЛЯ оптимізації

```
Limit  (cost=0.42..12.16 rows=20 width=64) (actual time=0.068..0.093 rows=20 loops=1)
  Buffers: shared hit=40 read=2
  ->  Nested Loop Left Join
        ->  Index Scan using idx_orders_status_created on orders o
              Index Cond: ((status = 'pending') AND (created_at >= ...) AND (created_at <= ...))
              Filter: (user_id = '...')
              Buffers: shared hit=20 read=2
        ->  Index Scan using "IDX_order_items_order_id" on order_items oi
```

### Порівняння

| Метрика | До | Після | Покращення |
|---------|-----|-------|------------|
| Cost | 15.71 | 12.16 | **-23%** |
| Buffers | 78 | 42 | **-46%** |
| Rows Removed | 37 | 0 | **-100%** |

### Чому planner обрав `idx_orders_status_created`?

PostgreSQL оцінює **селективність** кожного індексу:

- В тестових даних `status = 'pending'` відсіює ~2/3 замовлень → високоселективний
- Індекс `(status, created_at)` дозволяє одразу знайти потрібні записи

**В production** з багатьма користувачами `IDX_orders_user_created` буде ефективнішим.

---

## Тестування

### Запуск тесту конкурентності

```bash

npx ts-node scripts/concurrency-test.ts
```

**Очікуваний результат (stock = 13):**

```
📊 Results:
────────────────────────────────────────
   ✅ Successful (200/201): 13
   ⚠️  Insufficient Stock (409): 17
────────────────────────────────────────

✅ Concurrency test PASSED
```