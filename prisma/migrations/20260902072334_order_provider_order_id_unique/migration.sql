-- Makes Order.providerOrderId unique so a Razorpay order id maps back to
-- exactly one local Order (required for safe, idempotent webhook/verify
-- lookups independent of any in-memory state).
CREATE UNIQUE INDEX `orders_providerOrderId_key` ON `orders`(`providerOrderId`);
