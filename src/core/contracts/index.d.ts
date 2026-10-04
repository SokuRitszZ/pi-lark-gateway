/** Platform-native identity containers; optional by design, not an exclusive union. */
export interface PIGateway {
  Lark?: {
    source?: string;
    message_id?: string | null;
    chat_id?: string | null;
    chat_type?: string;
    sender: {
      open_id?: string | null;
      user_id?: string | null;
      union_id?: string | null;
      tenant_key?: string | null;
    };
    profile_status?: string;
    profile?: { name: string | null; en_name: string | null; email: string | null };
  };
  Telegram?: {
    source: 'telegram_gateway';
    bot_id: string;
    chat_id: string;
    message_id: string;
    message_thread_id: string | null;
    chat_type: 'private' | 'group' | 'supergroup';
    sender: { user_id: string; username: string | null };
    /** Owner-only synthetic policy subject; never a Telegram user ID. */
    simulation?: { label: string; policy_subject_id: string };
  };
  QQ?: {
    source: 'qq_gateway';
    app_id: string;
    message_id: string;
    chat_type: 'c2c' | 'group';
    group_openid: string | null;
    sender: { user_openid?: string; member_openid?: string };
  };
}

/** Normalized message within one platform/account-scoped gateway instance.
 * Field names and session keys intentionally preserve the existing storage contract.
 */
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
  onSession?(session: unknown | null): void;
  summarizeIntent?: boolean;
  appendImage?(image: unknown, options?: { isActive: () => boolean }): Promise<string>;
}

export interface AccessMessage {
  id?: string;
  chatId: string;
  userId?: string;
  isGroup: boolean;
  text: string;
  mentioned: boolean;
}

export interface GatewayAction {
  value?: { kind: string; id: string; action?: string; decision?: string };
  actorId?: string;
  messageId?: string;
  eventId?: string;
  instruction?: string;
}

/** Both identifiers and policies must belong to the same account scope. */
export interface GatewayIngressPacket {
  access: AccessMessage | null;
  readonly message: GatewayMessage | null;
  commandName?: string;
  executeCommand?: (message: GatewayMessage) => string | undefined | Promise<string | undefined>;
  debugLabel?: string;
}

export interface MediaDeliveryContext {
  signal?: AbortSignal;
  uuid?: string;
  /** Recheck after uploads and before external delivery. */
  allowed(): boolean;
  appendImage?: GatewayResponse['appendImage'];
}
