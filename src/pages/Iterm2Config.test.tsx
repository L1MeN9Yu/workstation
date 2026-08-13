import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Iterm2Config from "./Iterm2Config";
import {
  deleteIterm2Profile,
  listIterm2Profiles,
  writeIterm2Profile,
  type Iterm2ProfileFile,
} from "../lib/iterm2Config";

vi.mock("../lib/iterm2Config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/iterm2Config")>();
  return {
    ...actual,
    listIterm2Profiles: vi.fn(),
    writeIterm2Profile: vi.fn(),
    deleteIterm2Profile: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P1: Iterm2ProfileFile = {
  name: "default.json",
  path: "/Library/iTerm2/DynamicProfiles/default.json",
  content: JSON.stringify({ Name: "Default" }, null, 2),
};

const P2: Iterm2ProfileFile = {
  name: "work.json",
  path: "/Library/iTerm2/DynamicProfiles/work.json",
  content: JSON.stringify({ Name: "Work" }, null, 2),
};

async function renderPage(container: HTMLElement): Promise<Root> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<Iterm2Config />);
  });
  return root;
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
  const buttons = [...container.querySelectorAll("button")];
  const btn = buttons.find((b) => b.textContent === text);
  expect(btn).not.toBeUndefined();
  await act(async () => {
    btn!.click();
  });
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Iterm2Config", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(listIterm2Profiles).mockReset();
    vi.mocked(writeIterm2Profile).mockReset();
    vi.mocked(deleteIterm2Profile).mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  it("renders profile list and switches selection", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([P1, P2]);
    root = await renderPage(container);
    expect(container.textContent).toContain("default.json");
    expect(container.textContent).toContain("work.json");
    expect(container.textContent).toContain(P1.path);
    await clickButton(container, "work.json");
    expect(container.textContent).toContain(P2.path);
  });

  it("shows empty state when no profiles exist", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([]);
    root = await renderPage(container);
    expect(container.textContent).toContain("暂无 profile 文件，可在左侧新建");
  });

  it("creates a new profile with Profiles skeleton and selects it", async () => {
    const created: Iterm2ProfileFile = {
      name: "my-profile.json",
      path: "/Library/iTerm2/DynamicProfiles/my-profile.json",
      content: "",
    };
    vi.mocked(listIterm2Profiles).mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    root = await renderPage(container);
    const input = container.querySelector<HTMLInputElement>('input[placeholder="my-profile.json"]');
    expect(input).not.toBeNull();
    setInputValue(input!, "my-profile.json");
    await clickButton(container, "新建 profile");
    expect(writeIterm2Profile).toHaveBeenCalledTimes(1);
    const [writtenName, writtenContent] = vi.mocked(writeIterm2Profile).mock.calls[0];
    expect(writtenName).toBe("my-profile.json");
    const parsed = JSON.parse(writtenContent);
    expect(parsed.Profiles).toHaveLength(1);
    expect(parsed.Profiles[0].Name).toBe("Profile my-profile");
    expect(parsed.Profiles[0].Guid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(container.textContent).toContain(created.path);
  });

  it("rejects a file name without .json extension", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([]);
    root = await renderPage(container);
    const input = container.querySelector<HTMLInputElement>('input[placeholder="my-profile.json"]');
    setInputValue(input!, "my-profile");
    await clickButton(container, "新建 profile");
    expect(container.textContent).toContain("文件名必须以 .json 结尾");
    expect(writeIterm2Profile).not.toHaveBeenCalled();
  });

  it("rejects an empty file name", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([]);
    root = await renderPage(container);
    const input = container.querySelector<HTMLInputElement>('input[placeholder="my-profile.json"]');
    setInputValue(input!, "   ");
    await clickButton(container, "新建 profile");
    expect(container.textContent).toContain("请输入文件名");
    expect(writeIterm2Profile).not.toHaveBeenCalled();
  });

  it("reloads external changes when clicking the read button", async () => {
    vi.mocked(listIterm2Profiles)
      .mockResolvedValueOnce([P1])
      .mockResolvedValueOnce([
        { ...P1, content: JSON.stringify({ Name: "External Edit" }, null, 2) },
      ]);
    root = await renderPage(container);
    expect(container.textContent).toContain(P1.path);
    await clickButton(container, "读取");
    expect(listIterm2Profiles).toHaveBeenCalledTimes(2);
    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="如 My Profile"]');
    expect(nameInput?.value).toBe("External Edit");
  });

  it("shows an error when reading fails", async () => {
    vi.mocked(listIterm2Profiles)
      .mockResolvedValueOnce([P1])
      .mockRejectedValueOnce(new Error("transient"));
    root = await renderPage(container);
    await clickButton(container, "读取");
    expect(container.textContent).toContain("transient");
  });

  it("shows an error when loading fails", async () => {
    vi.mocked(listIterm2Profiles).mockRejectedValue(new Error("boom"));
    root = await renderPage(container);
    expect(container.textContent).toContain("读取失败");
    expect(container.textContent).toContain("boom");
  });

  it("shows an error when creating a profile fails", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([]);
    vi.mocked(writeIterm2Profile).mockRejectedValue(new Error("read-only"));
    root = await renderPage(container);
    const input = container.querySelector<HTMLInputElement>('input[placeholder="my-profile.json"]');
    setInputValue(input!, "new.json");
    await clickButton(container, "新建 profile");
    expect(container.textContent).toContain("read-only");
  });

  it("refreshes the profile list and shows a saved message after save", async () => {
    vi.mocked(listIterm2Profiles)
      .mockResolvedValueOnce([P1])
      .mockResolvedValueOnce([{ ...P1, content: JSON.stringify({ Name: "Updated" }, null, 2) }]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    root = await renderPage(container);
    await clickButton(container, "保存");
    expect(listIterm2Profiles).toHaveBeenCalledTimes(2);
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      JSON.stringify({ Name: "Default" }, null, 2),
    );
    expect(container.textContent).toContain("已保存（修改 0 项，删除 0 项）");
  });

  it("clears the saved message after it times out", async () => {
    vi.useFakeTimers();
    vi.mocked(listIterm2Profiles).mockResolvedValue([P1]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    root = await renderPage(container);
    await clickButton(container, "保存");
    const parentMsg = container.querySelector("div.mb-3.text-sm");
    expect(parentMsg?.textContent).toContain("已保存（修改");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4001);
    });
    expect(container.querySelector("div.mb-3.text-sm")).toBeNull();
  });

  it("deletes a profile after two-step confirmation", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValueOnce([P1, P2]).mockResolvedValueOnce([P2]);
    vi.mocked(deleteIterm2Profile).mockResolvedValue(undefined);
    root = await renderPage(container);
    expect(container.textContent).toContain("删除");
    await clickButton(container, "删除");
    expect(deleteIterm2Profile).not.toHaveBeenCalled();
    expect(container.textContent).toContain("确认？");
    await clickButton(container, "确认？");
    expect(deleteIterm2Profile).toHaveBeenCalledWith(P1.name);
    expect(listIterm2Profiles).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain(P1.path);
  });

  it("cancels confirmation by selecting another profile", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([P1, P2]);
    root = await renderPage(container);
    await clickButton(container, "删除");
    expect(container.textContent).toContain("确认？");
    await clickButton(container, "work.json");
    expect(container.textContent).not.toContain("确认？");
    expect(deleteIterm2Profile).not.toHaveBeenCalled();
  });

  it("shows an error when deleting a profile fails", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([P1]);
    vi.mocked(deleteIterm2Profile).mockRejectedValue(new Error("locked"));
    root = await renderPage(container);
    await clickButton(container, "删除");
    await clickButton(container, "确认？");
    expect(container.textContent).toContain("locked");
  });

  it("shows deleting state on the profile being deleted", async () => {
    vi.mocked(listIterm2Profiles).mockResolvedValue([P1]);
    vi.mocked(deleteIterm2Profile).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 50);
        }),
    );
    root = await renderPage(container);
    await clickButton(container, "删除");
    await clickButton(container, "确认？");
    expect(container.textContent).toContain("...");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
  });
});
