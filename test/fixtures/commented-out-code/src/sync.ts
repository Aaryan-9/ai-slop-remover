export async function syncRecords(records: string[]) {
  // const legacy = await fetchLegacyRecords();
  // for (const record of legacy) {
  //   await migrateRecord(record);
  // }
  // return legacy.length;
  return records.length;
}

// We intentionally sync sequentially rather than in parallel because the
// upstream API rate-limits per connection and burst traffic caused the
// provider to blacklist our IP range in the past. Do not parallelize this.
export async function syncSequentially(records: string[]) {
  const results: string[] = [];
  for (const record of records) {
    results.push(record.trim());
  }
  return results;
}
