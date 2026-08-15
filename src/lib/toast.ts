import { toast as sonnerToast, type ExternalToast } from "sonner";

export type ToastId = string | number;

export interface ToastApi {
  success: (message: string, options?: ExternalToast) => ToastId;
  error: (message: string, options?: ExternalToast) => ToastId;
  info: (message: string, options?: ExternalToast) => ToastId;
  warning: (message: string, options?: ExternalToast) => ToastId;
  dismiss: (id?: ToastId) => void;
}

export const toast: ToastApi = {
  success: (message, options) => sonnerToast.success(message, options),
  error: (message, options) => sonnerToast.error(message, options),
  info: (message, options) => sonnerToast.info(message, options),
  warning: (message, options) => sonnerToast.warning(message, options),
  dismiss: (id) => sonnerToast.dismiss(id),
};
