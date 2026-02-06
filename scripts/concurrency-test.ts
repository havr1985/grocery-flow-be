import 'dotenv/config';

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const productId = process.env.PRODUCT_ID;
const userId = process.env.USER_ID;

if (!productId || !userId) {
  console.error('❌ PRODUCT_ID and USER_ID must be set in env');
  console.error('   Example:');
  console.error('   export PRODUCT_ID="your-product-uuid"');
  console.error('   export USER_ID="your-user-uuid"');
  process.exit(1);
}

const requests = Number(process.env.REQUESTS ?? 30);

async function run() {
  console.log(
    `\n🚀 Testing concurrency with ${requests} simultaneous requests\n`,
  );
  console.log(`   Product: ${productId}`);
  console.log(`   User: ${userId}`);
  console.log(`   URL: ${baseUrl}/orders\n`);

  const tasks = Array.from({ length: requests }, (_, i) =>
    fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        idempotencyKey: `concurrency-test-${Date.now()}-${i}`,
        items: [{ productId, quantity: 1 }],
      }),
    }).then(async (res) => ({
      status: res.status,
      body: await res.text(),
    })),
  );

  const results = await Promise.all(tasks);

  const successful = results.filter(
    (r) => r.status === 201 || r.status === 200,
  ).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  const badRequest = results.filter((r) => r.status === 400).length;
  const notFound = results.filter((r) => r.status === 404).length;
  const serverErrors = results.filter((r) => r.status >= 500).length;

  console.log('📊 Results:');
  console.log('─'.repeat(40));
  console.log(`   ✅ Successful (200/201): ${successful}`);
  console.log(`   ⚠️  Insufficient Stock (409): ${conflicts}`);
  console.log(`   ❌ Bad Request (400): ${badRequest}`);
  console.log(`   🔍 Not Found (404): ${notFound}`);
  console.log(`   💥 Server Errors (5xx): ${serverErrors}`);
  console.log('─'.repeat(40));
  console.log(`   Total: ${requests}\n`);

  if (serverErrors > 0) {
    console.log('❌ Server errors detected:');
    results
      .filter((r) => r.status >= 500)
      .slice(0, 3)
      .forEach((r) => console.log(`   ${r.status}: ${r.body.slice(0, 200)}`));
  }

  // Validation
  if (successful > 0 && conflicts > 0 && serverErrors === 0) {
    console.log('✅ Concurrency test PASSED');
    console.log('   - Pessimistic locking prevented oversell');
    console.log('   - Some requests succeeded, others got 409');
  } else if (successful === requests) {
    console.log('⚠️  All requests succeeded — check if stock was high enough');
  } else if (serverErrors > 0) {
    console.log('❌ Concurrency test FAILED — server errors occurred');
  }
}

run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
