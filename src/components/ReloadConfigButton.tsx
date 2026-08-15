import { useState } from "react";
import {
  reloadCmuxConfig,
  reloadStatusMessage,
} from "../lib/cmuxConfig";
import { toast } from "../lib/toast";
import Button from "./Button";

export default function ReloadConfigButton() {
  const [reloading, setReloading] = useState(false);

  async function handleReload() {
    setReloading(true);
    try {
      const r = await reloadCmuxConfig();
      if (r.status === "success") {
        toast.success(reloadStatusMessage(r));
      } else {
        toast.error(reloadStatusMessage(r));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setReloading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" onClick={handleReload} disabled={reloading}>
        {reloading ? "重载中..." : "重新加载配置"}
      </Button>
    </div>
  );
}
