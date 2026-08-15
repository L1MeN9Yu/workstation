import { Toaster } from "sonner";
import { useTheme } from "../store/theme";

export default function ToastHost() {
  const theme = useTheme((s) => s.resolvedTheme);

  return (
    <Toaster
      position="top-right"
      theme={theme}
      closeButton
      richColors
      toastOptions={{ duration: 4000 }}
    />
  );
}
