import { Component, useMemo, useState, type ReactNode } from "react";
import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import type {
  ObjectFieldTemplateProps,
  RJSFSchema,
  UiSchema,
} from "@rjsf/utils";
import cmuxSchema from "../assets/cmux.schema.json";
import {
  mergeCmuxJsonc,
  parseCmuxJsonc,
  type DirtyField,
} from "../lib/cmuxJsonc";
import { writeCmuxConfig } from "../lib/cmuxConfig";
import { toast } from "../lib/toast";
import ReloadConfigButton from "./ReloadConfigButton";
import Alert from "./Alert";
import Button from "./Button";

const RENDER_SCHEMA = cmuxSchema as unknown as RJSFSchema;

const UI_SCHEMA: UiSchema = {
  $schema: { "ui:widget": "hidden" },
  schemaVersion: { "ui:widget": "hidden" },
};

const GROUP_TITLES: Record<string, string> = {
  app: "应用",
  terminal: "终端",
  notifications: "通知",
  sidebar: "侧边栏",
  workspaceColors: "工作区颜色",
  sidebarAppearance: "侧边栏外观",
  automation: "自动化",
  browser: "浏览器",
  markdown: "Markdown",
  fileEditor: "文件编辑",
  fileExplorer: "文件浏览",
  diffViewer: "差异查看",
  shortcuts: "快捷键",
  canvas: "画布",
  actions: "动作",
  commands: "命令",
  agentChat: "智能体聊天",
  vault: "存储",
  workspaceGroups: "工作区分组",
  surfaceTabBarButtons: "标签栏按钮",
  mobile: "移动端",
};

function collectLeafPaths(schema: RJSFSchema, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  const props = schema.properties;
  if (!props) return paths;
  for (const [key, child] of Object.entries(props)) {
    const p = [...prefix, key];
    const cs = child as RJSFSchema;
    if (cs.type === "object" && cs.properties) {
      paths.push(...collectLeafPaths(cs, p));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

function getValueAt(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function collectDirty(initial: unknown, current: unknown, paths: string[][]): DirtyField[] {
  const dirty: DirtyField[] = [];
  for (const path of paths) {
    const a = getValueAt(initial, path);
    const b = getValueAt(current, path);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      dirty.push({ path, value: b });
    }
  }
  return dirty;
}

const LEAF_PATHS = collectLeafPaths(RENDER_SCHEMA);

function CollapsibleGroupTemplate(props: ObjectFieldTemplateProps) {
  const ctx = props.registry.formContext as { explicitPaths?: string[] } | undefined;
  const explicitPaths = ctx?.explicitPaths ?? [];
  const path = (props.fieldPathId.path ?? []).join(".");
  const hasExplicit =
    path !== "" && explicitPaths.some((p) => p.startsWith(`${path}.`));
  const [open, setOpen] = useState(hasExplicit);
  const title = GROUP_TITLES[props.title] ?? props.title ?? path;

  return (
    <fieldset className="mb-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span>{title}</span>
        <span className="text-xs text-gray-400">{open ? "▾ 收起" : "▸ 展开"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
          {props.properties.map((p) => (
            <div key={p.name}>{p.content}</div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

class FormErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

interface Props {
  content: string;
}

export default function CmuxConfigForm({ content }: Props) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => ({ ...parseCmuxJsonc(content).json }));
  const [explicitPaths, setExplicitPaths] = useState<Set<string>>(
    () => new Set(parseCmuxJsonc(content).explicitPaths),
  );
  const [renderFailed, setRenderFailed] = useState(false);
  const [textMode, setTextMode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialData = useMemo(
    () => ({ ...parseCmuxJsonc(content).json }),
    [content],
  );

  const unsetCount = useMemo(() => {
    const all = LEAF_PATHS.map((p) => p.join(".")).filter((p) => p !== "$schema");
    return all.filter((p) => !explicitPaths.has(p)).length;
  }, [explicitPaths]);

  const explicitList = useMemo(
    () => Array.from(explicitPaths).filter((p) => p !== "$schema"),
    [explicitPaths],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const dirty = collectDirty(initialData, formData, LEAF_PATHS);
      if (dirty.length === 0) {
        toast.info("无变更");
        return;
      }
      const { text, errors } = mergeCmuxJsonc(content, dirty);
      if (errors.length > 0) {
        setError(`配置解析失败，未保存：${errors.join("; ")}`);
        return;
      }
      await writeCmuxConfig(text);
      const p = parseCmuxJsonc(text);
      setExplicitPaths(new Set(p.explicitPaths));
      setFormData({ ...p.json });
      toast.success(`已保存 ${dirty.length} 项变更`);
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveText() {
    setSaving(true);
    setError(null);
    try {
      await writeCmuxConfig(textMode);
      toast.success("已保存");
      setTextMode("");
      const p = parseCmuxJsonc(textMode);
      setExplicitPaths(new Set(p.explicitPaths));
      setFormData({ ...p.json });
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        未显式配置的字段显示 schema 默认值，修改后才会写入文件。未设置项：{unsetCount} 个
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      {renderFailed ? (
        <div>
          <Alert variant="warning" className="mb-2">
            表单渲染失败，已降级为文本编辑模式
          </Alert>
          <textarea
            className="min-h-[320px] w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            value={textMode || content}
            onChange={(e) => {
              setTextMode(e.target.value);
            }}
          />
        </div>
      ) : (
        <FormErrorBoundary onError={() => setRenderFailed(true)}>
          <Form
            schema={RENDER_SCHEMA}
            uiSchema={UI_SCHEMA}
            validator={validator}
            formData={formData}
            formContext={{ explicitPaths: explicitList }}
            templates={{ ObjectFieldTemplate: CollapsibleGroupTemplate }}
            onChange={(e) => {
              setFormData(e.formData as Record<string, unknown>);
            }}
          >
            <div />
          </Form>
        </FormErrorBoundary>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={renderFailed ? handleSaveText : handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="mt-3">
        <ReloadConfigButton />
      </div>
    </div>
  );
}
