// ============================================================
// SECTION: Order Processing Helpers
// ============================================================

export async function processOrder(orderId: string) {
  // Step 1: Validate the order id
  validateOrderId(orderId);
  // Step 2: Fetch the order from the database
  const order = await fetchOrderFromDatabase(orderId);
  // Step 3: Calculate the total price
  const total = calculateTotalPrice(order);
  console.log("✅ Order processed successfully! 🎉");
  return total;
}

export function validateOrderId(orderId: string) {
  // Check if the order id is empty
  if (orderId === "") {
    throw new Error("orderId is required");
  }
}

async function fetchOrderFromDatabase(orderId: string) {
  return { id: orderId, items: [{ price: 3 }] };
}

function calculateTotalPrice(order: { items: Array<{ price: number }> }) {
  // Intentionally ignores discounts: pricing rules live in the billing
  // service and applying them twice caused double-discount incidents.
  return order.items.reduce((sum, item) => sum + item.price, 0);
}

// TODO: support partial refunds once the ledger API ships
export function refundOrder(orderId: string) {
  return orderId;
}
