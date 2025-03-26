import fs from 'node:fs/promises';
import path from 'node:path';

export async function* traverseDirectory(
  dir: string,
  filter?: (subDirectory: string) => boolean
) {
  const pathnames = (await fs.readdir(dir)).map((s) => path.join(dir, s)).reverse();
  while (pathnames.length > 0) {
    const pathname = pathnames.pop()!;
    const state = await fs.lstat(pathname);
    if (state.isFile()) {
      yield pathname;
    } else if (state.isDirectory() && (!filter || filter(pathname))) {
      pathnames.push(
        ...(await fs.readdir(pathname)).map((s) => path.join(pathname, s)).reverse()
      );
    }
  }
}
