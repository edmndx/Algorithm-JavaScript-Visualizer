export function indexMarkerNames<Key extends string | number>(
  markers: Readonly<Record<string, readonly Key[]>>,
): ReadonlyMap<Key, readonly string[]> {
  const namesByKey = new Map<Key, string[]>();

  for (const [name, keys] of Object.entries(markers)) {
    for (const key of keys) {
      const names = namesByKey.get(key) ?? [];
      names.push(name);
      namesByKey.set(key, names);
    }
  }

  return namesByKey;
}
