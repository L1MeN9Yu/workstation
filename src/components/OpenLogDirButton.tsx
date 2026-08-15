import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../lib/toast";
import Button from "./Button";

export default function OpenLogDirButton() {
  const [opening, setOpening] = useState(false);

  async function handleOpen() {
    setOpening(true);
    try {
      await invoke("open_log_dir");
      toast.success("已打开日志目录");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        onClick={() => void handleOpen()}
        disabled={opening}
        className="px-3 py-1"
      >
        {opening ? "打开中..." : "打开日志目录"}
      </Button>
    </div>
  );
}
