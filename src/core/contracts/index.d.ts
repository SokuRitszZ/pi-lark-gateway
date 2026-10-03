/** Platform-native identity containers; optional by design, not an exclusive union. */
export interface PIGateway {
  Lark?: {
    open_id?: string | null;
    user_id?: string | null;
    union_id?: string | null;
    tenant_key?: string | null;
  };
  /** QQ fields will be specified against verified platform events. */
  QQ?: Record<string, unknown>;
}

/** Transitional normalized message: preserve existing Lark session keys and fields. */
export interface GatewayMessage {
  id: string;
  key: string;
  text: string;
  chatId: string;
  userId?: string;
  isGroup: boolean;
  root?: string;
  type?: string;
  identity?: PIGateway;
  attachments?: readonly unknown[];
  mentions?: readonly unknown[];
  debugSleepMs?: number;
}

/** The dispatcher does not interpret event payloads or render platform UI. */
export interface GatewayResponse {
  event?(event: unknown): void;
  finish(text: string, options?: { error: boolean }): Promise<void>;
  stop(): Promise<void>;
}
