import parser from '@babel/parser';
import traverse from '@babel/traverse';
import t from '@babel/types';
import { transform } from 'esbuild';
import fs from 'node:fs/promises';
import { compileTemplate, parse } from 'vue/compiler-sfc';
import { traverseDirectory } from './utils';
import buffer from 'node:buffer';
import path from 'node:path';

const fixTraverse: typeof traverse =
  typeof traverse === 'function' ? traverse : Reflect.get(traverse, 'default');

const preCodeExtList = ['ts', 'jsx', 'tsx'] as const;
const codeExtList = ['js', ...preCodeExtList] as const;
const fileExtList = [...codeExtList, 'vue'] as const;
const zhReg = /[\u4e00-\u9fa5]/g;
const hasZhStr = (str: string): boolean => {
  for (const s of str) {
    if (zhReg.test(s)) {
      return true;
    }
  }
  return false;
};

const transformWithEsbuild = async (
  code: string,
  ext?: (typeof codeExtList)[number]
) => {
  const r = await transform(code, {
    loader: ext ?? 'js',
    minify: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    minifyWhitespace: false,
    treeShaking: false,
    keepNames: true,
    lineLimit: 0,
    target: 'ESNext',
    sourcemap: false,
    charset: 'utf8',
    tsconfigRaw: {
      compilerOptions: {
        preserveValueImports: true,
        importsNotUsedAsValues: 'preserve',
        verbatimModuleSyntax: true,
      },
    },
  });
  return r.code;
};

const getCodesFromFile = async (
  filePath: string,
  ext: (typeof fileExtList)[number]
): Promise<string[]> => {
  const text = await fs.readFile(filePath, 'utf-8');
  const codes: string[] = [];
  if (!hasZhStr(text)) {
    return codes;
  }
  if (ext === 'vue') {
    const r = parse(text, { filename: filePath, sourceMap: false });
    const { script, scriptSetup, template } = r.descriptor;
    if (script) {
      codes.push(
        await transformWithEsbuild(
          script.content,
          preCodeExtList.find((v) => v === script.lang)
        )
      );
    }
    if (scriptSetup) {
      codes.push(
        await transformWithEsbuild(
          scriptSetup.content,
          preCodeExtList.find((v) => v === scriptSetup.lang)
        )
      );
    }
    if (template) {
      const r = compileTemplate({
        id: 'vue',
        filename: filePath,
        source: template.content,
        transformAssetUrls: false,
        compilerOptions: {
          comments: false,
          hoistStatic: false,
        },
      });
      codes.push(r.code);
    }
  } else {
    codes.push(await transformWithEsbuild(text, ext));
  }
  return codes.filter((v) => hasZhStr(v));
};

const flatBinaryExpression = (
  node: t.PrivateName | t.Expression,
  pushUsed: (node: t.Node) => void
): (t.PrivateName | t.Expression)[] => {
  if (t.isBinaryExpression(node) && node.operator === '+') {
    pushUsed(node);
    return flatBinaryExpression(node.left, pushUsed).concat(
      flatBinaryExpression(node.right, pushUsed)
    );
  }
  return [node];
};

const pickZhStrByAst = (code: string): string[] => {
  const program = parser.parse(code, {
    sourceType: 'module',
  });
  const zhStrSet = new Set<string>();
  const usedNodes: t.Node[] = [];
  const hasUsedSet = (node: t.Node) => {
    return usedNodes.some((v) => v.start === node.start && v.end === node.end);
  };
  const pushUsed = (node: t.Node) => {
    if (!hasUsedSet(node)) {
      usedNodes.push(node);
    }
  };
  fixTraverse(program, {
    StringLiteral(path) {
      const node = path.node;
      if (hasUsedSet(node)) return;
      pushUsed(node);
      zhStrSet.add(node.value.trim());
    },
    TemplateLiteral(path) {
      const node = path.node;
      if (hasUsedSet(node)) return;
      pushUsed(node);
      zhStrSet.add(node.quasis.map((v) => v.value.raw.trim()).join('{}'));
    },
    BinaryExpression(path) {
      const node = path.node;
      if (hasUsedSet(node)) return;
      pushUsed(node);
      if (!node.start || !node.end) {
        throw new Error('node.start or node.end is undefined');
      }
      if (
        node.operator === '+' &&
        hasZhStr(code.substring(node.start, node.end))
      ) {
        const flatNodes = flatBinaryExpression(node, pushUsed);
        zhStrSet.add(
          flatNodes
            .map((v) => {
              if (t.isTemplateLiteral(v)) {
                pushUsed(v);
                return v.quasis.map((v) => v.value.raw.trim()).join('{}');
              } else if (t.isStringLiteral(v)) {
                pushUsed(v);
                return v.value.trim();
              }
              return '{}';
            })
            .join('')
        );
      }
    },
  });
  return Array.from(zhStrSet)
    .filter((v) => hasZhStr(v))
    .map((v) => v.trim().replace(rmREg, ''))
    .filter(Boolean);
};
const rmREg = /(^\{\})|(\{\}$)/;

const getStrHashode = (str: string) => {
  let hash = 0,
    i,
    char;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
};

const getKeyFromStr = (str: string): string => {
  const code = getStrHashode(str);
  const a = buffer.Buffer.from(new Int32Array([code]).buffer)
    .toString('base64url')
    .replaceAll('-', '_');
  if (Number.isInteger(Number(a[0]))) {
    return '_' + a;
  }
  return a;
};

const collectDirZhStr = async (dir: string) => {
  const textList: { name: string; data: Record<string, string> }[] = [];
  for await (const filePath of traverseDirectory(dir, (p) => {
    const baseName = p.split(/[\\\/]/).at(-1);
    return (
      baseName !== 'node_modules' &&
      baseName !== 'dist' &&
      baseName !== 'public'
    );
  })) {
    const ext = fileExtList.find(
      (v) => filePath.endsWith(v) && filePath.at(-v.length - 1) === '.'
    );
    if (!ext) continue;
    const codes = await getCodesFromFile(filePath, ext);
    if (!codes.length) continue;
    const zhStrList = Array.from(
      new Set(codes.map((v) => pickZhStrByAst(v)).flat(1))
    );
    if (!zhStrList.length) continue;
    textList.push({
      name: filePath.substring(dir.length + 1).replaceAll(/\\/g, '/'),
      data: Object.fromEntries(zhStrList.map((v) => [getKeyFromStr(v), v])),
    });
  }

  await fs.mkdir(process.cwd() + '/dist').catch(() => {});
  await fs.writeFile(
    process.cwd() + `/dist/${path.basename(dir)}.zh.json`,
    JSON.stringify(
      Object.fromEntries(textList.map((v) => [v.name, v.data])),
      undefined,
      2
    ),
    'utf-8'
  );
  console.log(dir);
  console.log(`pick file count: ${textList.length}\n`);
};

const folderList = (
  await fs.readFile(process.cwd() + '/folder.txt', 'utf-8').catch(() => '')
)
  .split('\n')
  .map((v) => v.trim())
  .filter(Boolean);

if (folderList.length === 0) {
  console.log('folder.txt is empty');
} else {
  for (const folder of folderList) {
    await collectDirZhStr(folder);
  }
}
