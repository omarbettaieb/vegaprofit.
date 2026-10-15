// Thin wrapper around admin.graphql: returns `data`, throws on GraphQL errors, and paces itself
// against Shopify's cost-based rate limit (retries when THROTTLED).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

export type AdminLike = {
  graphql: (
    query: string,
    options?: { variables?: AnyJson },
  ) => Promise<{ json: () => Promise<AnyJson> }>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function adminQuery<T>(
  admin: AdminLike,
  query: string,
  variables: Record<string, unknown> = {},
  maxRetries = 6,
  wait: (ms: number) => Promise<void> = sleep, // injectable so tests do not really wait
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await admin.graphql(query, { variables });
    const body: AnyJson = await res.json();

    const errors: { message?: string; extensions?: { code?: string } }[] = body?.errors ?? [];
    const throttled = errors.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < maxRetries) {
      await wait(Math.min(2000 * (attempt + 1), 10000));
      continue;
    }
    if (errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${errors.map((e) => e.message).join("; ")}`);
    }

    // Proactive pacing: if the bucket cannot cover the next query of the same size, wait for it.
    const cost = body?.extensions?.cost;
    const status = cost?.throttleStatus;
    if (status && cost.requestedQueryCost && status.restoreRate > 0) {
      const needed = cost.requestedQueryCost - status.currentlyAvailable;
      if (needed > 0) await wait(Math.ceil((needed / status.restoreRate) * 1000));
    }
    return body.data as T;
  }
}
