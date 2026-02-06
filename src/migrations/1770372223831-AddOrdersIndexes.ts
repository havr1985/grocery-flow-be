import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrdersIndexes1770372223831 implements MigrationInterface {
  name = 'AddOrdersIndexes1770372223831';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_orders_user_created" 
      ON "orders" ("user_id", "created_at" DESC)
    `);

    // Composite index for admin panel: filter by status + sort by date
    await queryRunner.query(`
      CREATE INDEX "IDX_orders_status_created" 
      ON "orders" ("status", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_orders_status_created"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_user_created"`);
  }
}
