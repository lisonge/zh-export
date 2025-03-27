import fs from 'node:fs/promises';
import path from 'node:path';

export const posixPath = (str: string): string => {
  if (str.includes('\\')) {
    return str.replaceAll('\\', '/');
  }
  return str;
};

export async function* traverseDirectory(
  dir: string,
  filter?: (subDirectory: string) => boolean
) {
  const pathnames = (await fs.readdir(dir))
    .map((s) => posixPath(path.join(dir, s)))
    .reverse();
  while (pathnames.length > 0) {
    const pathname = pathnames.pop()!;
    const state = await fs.lstat(pathname);
    if (state.isFile()) {
      yield pathname;
    } else if (state.isDirectory() && (!filter || filter(pathname))) {
      pathnames.push(
        ...(await fs.readdir(pathname))
          .map((s) => posixPath(path.join(pathname, s)))
          .reverse()
      );
    }
  }
}
