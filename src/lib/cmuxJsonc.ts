import {
  applyEdits,
  modify,
  parse,
  parseTree,
  type ModificationOptions,
  type Node,
  type ParseError,
} from "jsonc-parser";

export interface CmuxJsoncParse {
  json: Record<string, unknown>;
  explicitPaths: string[];
  hasErrors: boolean;
}

export interface DirtyField {
  path: string[];
  value: unknown;
}

const MODIFY_OPTIONS: ModificationOptions = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
};

function pathKey(path: string[]): string {
  return path.join(".");
}

function collectPropertyPaths(node: Node | undefined, prefix: string[], out: string[]): void {
  if (!node) return;
  if (node.type === "object") {
    for (const child of node.children!) {
      const key = child.children![0].value as string;
      const full = [...prefix, key];
      out.push(pathKey(full));
      collectPropertyPaths(child.children![1], full, out);
    }
  } else if (node.type === "array") {
    node.children!.forEach((child, i) => {
      collectPropertyPaths(child, [...prefix, String(i)], out);
    });
  }
}

export function parseCmuxJsonc(content: string): CmuxJsoncParse {
  const errors: ParseError[] = [];
  const options = { allowTrailingComma: true, disallowComments: false };
  const json = (parse(content, errors, options) ?? {}) as Record<string, unknown>;
  const tree = parseTree(content, errors, options);
  const explicitPaths: string[] = [];
  collectPropertyPaths(tree, [], explicitPaths);
  return { json, explicitPaths, hasErrors: errors.length > 0 };
}

function resolveNode(content: string, path: string[]): Node | undefined {
  const errors: ParseError[] = [];
  let node = parseTree(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })!;
  for (const seg of path) {
    if (node.type !== "object") return undefined;
    const prop = node.children!.find((c) => c.children![0].value === seg);
    if (!prop) return undefined;
    node = prop.children![1];
  }
  return node;
}

export function mergeCmuxJsonc(
  content: string,
  dirty: DirtyField[],
): { text: string; errors: string[] } {
  if (dirty.length === 0) return { text: content, errors: [] };
  const baseErrors: ParseError[] = [];
  parse(content, baseErrors, { allowTrailingComma: true, disallowComments: false });
  if (baseErrors.length > 0) {
    return { text: "", errors: baseErrors.map((e) => e.error.toString()) };
  }
  let text = content;
  for (const d of dirty) {
    for (let depth = 1; depth < d.path.length; depth++) {
      const parent = d.path.slice(0, depth);
      if (resolveNode(text, parent)) continue;
      const grand = d.path.slice(0, depth - 1);
      if (grand.length === 0) {
        text = applyEdits(text, modify(text, parent, {}, MODIFY_OPTIONS));
        continue;
      }
      const grandNode = resolveNode(text, grand)!;
      if (grandNode.type !== "object") break;
      text = applyEdits(text, modify(text, parent, {}, MODIFY_OPTIONS));
    }
  }
  for (const d of dirty) {
    const parent = resolveNode(text, d.path.slice(0, -1));
    if (parent === undefined || parent.type !== "object") {
      return { text: "", errors: [`无法写入 ${d.path.join(".")}：父级不是配置对象`] };
    }
    text = applyEdits(text, modify(text, d.path, d.value, MODIFY_OPTIONS));
  }
  return { text, errors: [] };
}
