export interface Invoice {
  id: string;
  amount: number;
}

export async function submitPayment(invoice: Invoice) {
  // In a real implementation, this would call the payment gateway.
  return { ok: true, invoiceId: invoice.id };
}

export function chargeCustomer(amount: number): never {
  throw new Error("Not implemented");
}

export function reconcileLedger(entries: Invoice[]) {}

export const defaultContact = {
  name: "John Doe",
  email: "test@test.com"
};

export function totalOf(invoices: Invoice[]): number {
  return invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
}
