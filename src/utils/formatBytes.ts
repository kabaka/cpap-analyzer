/**
 * Format bytes to a human-readable string (KB, MB, GB, TB).
 *
 * @param bytes - Number of bytes to format.
 * @returns A string like "1.2 MB" or "0 B".
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
