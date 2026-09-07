/** Compact graph encoding keeps shared immutable packages out of every history entry. */
export function encodeQueueSnapshot(value: unknown): string {
  const seen = new Map<object, number>();
  const nodes: unknown[] = [];
  const visit = (item: unknown): unknown => {
    if (item === undefined) return { u: true };
    if (item === null || typeof item !== "object") return item;
    const known = seen.get(item);
    if (known !== undefined) return { r: known };
    const index = nodes.length;
    seen.set(item, index);
    nodes.push(null);
    nodes[index] =
      item instanceof Map
        ? ["map", [...item].map(([k, v]) => [visit(k), visit(v)])]
        : item instanceof Set
          ? ["set", [...item].map(visit)]
          : Array.isArray(item)
            ? ["array", item.map(visit)]
            : ["object", Object.entries(item).map(([k, v]) => [k, visit(v)])];
    return { r: index };
  };
  const root = visit(value);
  return JSON.stringify({ version: 1, root, nodes });
}
export function decodeQueueSnapshot<T>(raw: string): T {
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.nodes))
    throw Error("Unsupported queue checkpoint");
  const cache = new Map<number, unknown>();
  const visit = (token: any): any => {
    if (token === null || typeof token !== "object") return token;
    if (token.u) return undefined;
    const index = token.r;
    if (!Number.isInteger(index) || !data.nodes[index])
      throw Error("Invalid queue reference");
    if (cache.has(index)) return cache.get(index);
    const [kind, entries] = data.nodes[index];
    if (
      !["map", "set", "array", "object"].includes(kind) ||
      !Array.isArray(entries)
    )
      throw Error("Invalid queue node");
    const value =
      kind === "map"
        ? new Map()
        : kind === "set"
          ? new Set()
          : kind === "array"
            ? []
            : {};
    cache.set(index, value);
    if (kind === "map")
      entries.forEach(([k, v]: any[]) =>
        (value as Map<unknown, unknown>).set(visit(k), visit(v)),
      );
    else if (kind === "set")
      entries.forEach((v: any) => (value as Set<unknown>).add(visit(v)));
    else if (kind === "array")
      entries.forEach((v: any) => (value as unknown[]).push(visit(v)));
    else
      entries.forEach(([k, v]: any[]) => {
        Object.defineProperty(value, k, {
          value: visit(v),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      });
    return value;
  };
  return visit(data.root) as T;
}
