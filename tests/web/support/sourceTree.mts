import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RepositorySourceFile = Readonly<{
  relativePath: string;
  source: string;
}>;

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceExtension = /\.(?:ts|tsx)$/u;

const normalizePath = (path: string): string => path.split(sep).join('/');

export const readRepositoryText = (relativePath: string): Promise<string> => (
  readFile(resolve(repositoryRoot, relativePath), 'utf8')
);

/** Read a repository TypeScript subtree once for architectural contract checks. */
export async function readTypeScriptSourceTree(relativeDirectory: string): Promise<readonly RepositorySourceFile[]> {
  const directory = resolve(repositoryRoot, relativeDirectory);

  const visit = async (current: string): Promise<RepositorySourceFile[]> => {
    const entries = await readdir(current, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) return visit(path);
      if (!sourceExtension.test(entry.name)) return [];
      return [{
        relativePath: normalizePath(relative(repositoryRoot, path)),
        source: await readFile(path, 'utf8'),
      }];
    }));
    return files.flat();
  };

  return (await visit(directory)).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
